// Package db is the gateway's only path to Postgres. The gateway role has no table access
// in schema app; everything goes through the app.gw_* SECURITY DEFINER functions, plus the
// gateway-private session registry.
package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DB struct {
	pool *pgxpool.Pool
}

func Connect(ctx context.Context, url string) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("db: parse url: %w", err)
	}
	// A hosted connection pooler can set a smaller limit with pool_max_conns in the URL.
	if !strings.Contains(url, "pool_max_conns=") {
		cfg.MaxConns = 16
	}
	cfg.ConnConfig.RuntimeParams["application_name"] = "qa-gateway"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}
	return &DB{pool: pool}, nil
}

func (d *DB) Close() { d.pool.Close() }

func (d *DB) Ping(ctx context.Context) error { return d.pool.Ping(ctx) }

// ---------------------------------------------------------------------------
// gateway.sessions
// ---------------------------------------------------------------------------

type SessionRow struct {
	UserID     string
	StoreFile  string
	KEKID      string
	WrappedDEK []byte
	Status     string
}

var ErrNotFound = errors.New("db: not found")

func (d *DB) InsertSession(ctx context.Context, r SessionRow, owner string, leaseFor time.Duration) error {
	_, err := d.pool.Exec(ctx, `
		INSERT INTO gateway.sessions (user_id, store_file, kek_id, wrapped_dek, status, lease_owner, lease_until)
		VALUES ($1, $2, $3, $4, $5, $6, now() + $7 * interval '1 second')`,
		r.UserID, r.StoreFile, r.KEKID, r.WrappedDEK, r.Status, owner, secs(leaseFor))
	return err
}

func (d *DB) GetSession(ctx context.Context, userID string) (*SessionRow, error) {
	var r SessionRow
	err := d.pool.QueryRow(ctx, `
		SELECT user_id, store_file, kek_id, wrapped_dek, status FROM gateway.sessions WHERE user_id = $1`,
		userID).Scan(&r.UserID, &r.StoreFile, &r.KEKID, &r.WrappedDEK, &r.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &r, err
}

func (d *DB) SetSessionStatus(ctx context.Context, userID, status string) error {
	_, err := d.pool.Exec(ctx, `UPDATE gateway.sessions SET status = $2, updated_at = now() WHERE user_id = $1`, userID, status)
	return err
}

// DeleteSession removes the wrapped store key. Together with deleting the file this
// crypto-shreds the tenant's WhatsApp credentials.
func (d *DB) DeleteSession(ctx context.Context, userID string) error {
	_, err := d.pool.Exec(ctx, `DELETE FROM gateway.sessions WHERE user_id = $1`, userID)
	return err
}

// ClaimLinkedSessions takes the lease on linked sessions that nobody else holds.
func (d *DB) ClaimLinkedSessions(ctx context.Context, owner string, leaseFor time.Duration) ([]SessionRow, error) {
	rows, err := d.pool.Query(ctx, `
		UPDATE gateway.sessions
		SET lease_owner = $1, lease_until = now() + $2 * interval '1 second'
		WHERE status = 'linked' AND (lease_owner = $1 OR lease_until IS NULL OR lease_until < now())
		RETURNING user_id, store_file, kek_id, wrapped_dek, status`, owner, secs(leaseFor))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (SessionRow, error) {
		var r SessionRow
		err := row.Scan(&r.UserID, &r.StoreFile, &r.KEKID, &r.WrappedDEK, &r.Status)
		return r, err
	})
}

// RenewLeases extends the lease on every session this instance owns and reports which
// sessions it no longer owns (someone else took over) so they can be stopped.
func (d *DB) RenewLeases(ctx context.Context, owner string, leaseFor time.Duration, held []string) (lost []string, err error) {
	rows, err := d.pool.Query(ctx, `
		UPDATE gateway.sessions SET lease_until = now() + $2 * interval '1 second'
		WHERE lease_owner = $1 AND user_id = ANY($3)
		RETURNING user_id`, owner, secs(leaseFor), held)
	if err != nil {
		return nil, err
	}
	kept, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	keptSet := make(map[string]bool, len(kept))
	for _, k := range kept {
		keptSet[k] = true
	}
	for _, h := range held {
		if !keptSet[h] {
			lost = append(lost, h)
		}
	}
	return lost, nil
}

// DeleteStalePairings removes abandoned link attempts and returns them so their files can be destroyed.
func (d *DB) DeleteStalePairings(ctx context.Context, olderThan time.Duration) ([]SessionRow, error) {
	rows, err := d.pool.Query(ctx, `
		DELETE FROM gateway.sessions
		WHERE status = 'pairing' AND created_at < now() - $1 * interval '1 second'
		RETURNING user_id, store_file, kek_id, wrapped_dek, status`, secs(olderThan))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (SessionRow, error) {
		var r SessionRow
		err := row.Scan(&r.UserID, &r.StoreFile, &r.KEKID, &r.WrappedDEK, &r.Status)
		return r, err
	})
}

func (d *DB) ReleaseLeases(ctx context.Context, owner string) error {
	_, err := d.pool.Exec(ctx, `UPDATE gateway.sessions SET lease_owner = NULL, lease_until = NULL WHERE lease_owner = $1`, owner)
	return err
}

// ---------------------------------------------------------------------------
// app.gw_* functions
// ---------------------------------------------------------------------------

func (d *DB) SetLinkStatus(ctx context.Context, userID, status, deviceLabel, phoneHint, errMsg string) error {
	_, err := d.pool.Exec(ctx, `SELECT app.gw_set_link_status($1, $2::app.wa_status, $3, $4, $5)`,
		userID, status, nullIfEmpty(deviceLabel), nullIfEmpty(phoneHint), nullIfEmpty(errMsg))
	return err
}

func (d *DB) GetContentKey(ctx context.Context, userID string) (kekID string, wrapped []byte, err error) {
	err = d.pool.QueryRow(ctx, `SELECT kek_id, wrapped_dek FROM app.gw_get_content_key($1)`, userID).Scan(&kekID, &wrapped)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, ErrNotFound
	}
	return kekID, wrapped, err
}

func (d *DB) PutContentKey(ctx context.Context, userID, kekID string, wrapped []byte) error {
	_, err := d.pool.Exec(ctx, `SELECT app.gw_put_content_key($1, $2, $3)`, userID, kekID, wrapped)
	return err
}

type Group struct {
	JID            string `json:"jid"`
	Name           string `json:"name"`
	IsAnnouncement bool   `json:"is_announcement"`
	IsParent       bool   `json:"is_parent"`
	ParentJID      string `json:"parent_jid,omitempty"`
	Participants   int    `json:"participants"`
}

func (d *DB) UpsertGroups(ctx context.Context, userID string, groups []Group) (int, error) {
	payload, err := json.Marshal(groups)
	if err != nil {
		return 0, err
	}
	var n int
	err = d.pool.QueryRow(ctx, `SELECT app.gw_upsert_groups($1, $2::jsonb)`, userID, payload).Scan(&n)
	return n, err
}

func (d *DB) ListMonitored(ctx context.Context, userID string) ([]string, error) {
	rows, err := d.pool.Query(ctx, `SELECT * FROM app.gw_list_monitored($1)`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

type InboundMessage struct {
	ID               uuid.UUID
	UserID           string
	GroupJID         string
	WAMessageID      string
	SenderHash       string
	SenderIsAdmin    bool
	SenderNameEnc    []byte
	SentAt           time.Time
	Kind             string
	BodyEnc          []byte
	QuotedID         string
	MediaDescEnc     []byte
	MediaMime        string
	MediaSize        int64
	MediaFilenameEnc []byte
	IsEdit           bool
	IsBackfill       bool
}

// IngestMessage stores an (already encrypted) group message and enqueues processing.
// Returns uuid.Nil when the database dropped it (duplicate, or group not monitored).
func (d *DB) IngestMessage(ctx context.Context, m InboundMessage) (uuid.UUID, error) {
	var id *uuid.UUID
	err := d.pool.QueryRow(ctx, `SELECT app.gw_ingest_message($1,$2,$3,$4,$5,$6,$7,$8,$9::app.msg_kind,$10,$11,$12,$13,$14,$15,$16,$17)`,
		m.ID, m.UserID, m.GroupJID, m.WAMessageID, m.SenderHash, m.SenderIsAdmin, m.SenderNameEnc,
		m.SentAt, m.Kind, m.BodyEnc, nullIfEmpty(m.QuotedID), m.MediaDescEnc, nullIfEmpty(m.MediaMime),
		nullIfZero(m.MediaSize), m.MediaFilenameEnc, m.IsEdit, m.IsBackfill).Scan(&id)
	if err != nil || id == nil {
		return uuid.Nil, err
	}
	return *id, nil
}

func (d *DB) MarkRevoked(ctx context.Context, userID, groupJID, waMessageID string) error {
	_, err := d.pool.Exec(ctx, `SELECT app.gw_mark_revoked($1, $2, $3)`, userID, groupJID, waMessageID)
	return err
}

func (d *DB) IngestCommand(ctx context.Context, id uuid.UUID, userID, waMessageID string, textEnc []byte, quoted string) error {
	_, err := d.pool.Exec(ctx, `SELECT app.gw_ingest_command($1, $2, $3, $4, $5)`, id, userID, waMessageID, textEnc, nullIfEmpty(quoted))
	return err
}

type MediaDescriptor struct {
	Kind        string
	DescEnc     []byte
	Mime        string
	Size        int64
	GroupJID    string
	WAMessageID string
}

func (d *DB) GetMediaDescriptor(ctx context.Context, userID string, messageID uuid.UUID) (*MediaDescriptor, error) {
	var m MediaDescriptor
	var mime *string
	var size *int64
	err := d.pool.QueryRow(ctx, `SELECT kind::text, media_desc_enc, media_mime, media_size, group_jid, wa_message_id
		FROM app.gw_get_media_descriptor($1, $2)`,
		userID, messageID).Scan(&m.Kind, &m.DescEnc, &mime, &size, &m.GroupJID, &m.WAMessageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if mime != nil {
		m.Mime = *mime
	}
	if size != nil {
		m.Size = *size
	}
	return &m, nil
}

func secs(d time.Duration) int64 { return int64(d / time.Second) }

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullIfZero(n int64) any {
	if n == 0 {
		return nil
	}
	return n
}

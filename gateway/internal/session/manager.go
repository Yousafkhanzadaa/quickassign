package session

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"

	"github.com/quickassign/gateway/internal/config"
	"github.com/quickassign/gateway/internal/db"
	"github.com/quickassign/gateway/internal/logx"
	"github.com/quickassign/gateway/internal/seal"
	"github.com/quickassign/gateway/internal/wastore"
)

const (
	leaseFor       = 90 * time.Second
	leaseRenew     = 30 * time.Second
	pairingTimeout = 4 * time.Minute
)

var (
	ErrAlreadyLinked = errors.New("session: WhatsApp is already linked; unlink first")
	ErrBadPhone      = errors.New("session: phone number must be in international format, e.g. 923001234567")
)

var phonePattern = regexp.MustCompile(`^[1-9][0-9]{9,14}$`)

// Manager owns every session served by this gateway instance.
type Manager struct {
	cfg    *config.Config
	db     *db.DB
	log    *slog.Logger
	pepper []byte

	mu       sync.Mutex
	sessions map[string]*Session
}

func NewManager(cfg *config.Config, database *db.DB, log *slog.Logger) (*Manager, error) {
	pepper, err := cfg.AppKEK.DeriveSubkey("qa/v1/sender-pepper")
	if err != nil {
		return nil, err
	}
	return &Manager{cfg: cfg, db: database, log: log, pepper: pepper, sessions: map[string]*Session{}}, nil
}

// Start resumes linked sessions that no other instance holds and keeps leases fresh.
func (m *Manager) Start(ctx context.Context) error {
	stale, err := m.db.DeleteStalePairings(ctx, 10*time.Minute)
	if err != nil {
		return fmt.Errorf("cleanup stale pairings: %w", err)
	}
	for _, r := range stale {
		_ = wastore.Destroy(m.cfg.StoreDir, r.StoreFile)
	}
	if err := m.claimAndResume(ctx); err != nil {
		return err
	}
	go m.leaseLoop(ctx)
	go m.refreshLoop(ctx)
	return nil
}

func (m *Manager) claimAndResume(ctx context.Context) error {
	rows, err := m.db.ClaimLinkedSessions(ctx, m.cfg.InstanceID, leaseFor)
	if err != nil {
		return fmt.Errorf("claim sessions: %w", err)
	}
	i := 0
	for _, r := range rows {
		m.mu.Lock()
		_, running := m.sessions[r.UserID]
		m.mu.Unlock()
		if running {
			continue
		}
		delay := time.Duration(i) * 250 * time.Millisecond // stagger reconnects
		i++
		go func(r db.SessionRow) {
			time.Sleep(delay)
			if err := m.resume(ctx, r); err != nil {
				m.log.Error("resume failed", "tenant", logx.TenantTag(r.UserID), "err", err)
			}
		}(r)
	}
	return nil
}

func (m *Manager) waLogger(userID string) *slog.Logger {
	return m.log.With("tenant", logx.TenantTag(userID))
}

func (m *Manager) openStore(ctx context.Context, r db.SessionRow) (*wastore.Store, error) {
	if r.KEKID != m.cfg.GatewayKEK.ID {
		return nil, fmt.Errorf("store key wrapped with unknown KEK %q", r.KEKID)
	}
	key, err := m.cfg.GatewayKEK.Unwrap(r.WrappedDEK, "wastore", r.UserID)
	if err != nil {
		return nil, fmt.Errorf("unwrap store key: %w", err)
	}
	defer seal.Zero(key)
	return wastore.Open(ctx, m.cfg.StoreDir, r.StoreFile, key, logx.WhatsApp(m.waLogger(r.UserID), "store", slog.LevelWarn))
}

func (m *Manager) newClient(dev *store.Device, userID string) *whatsmeow.Client {
	cli := whatsmeow.NewClient(dev, logx.WhatsApp(m.waLogger(userID), "wa", slog.LevelWarn))
	cli.EnableAutoReconnect = true
	cli.AutomaticMessageRerequestFromPhone = true
	cli.EmitAppStateEventsOnFullSync = false
	return cli
}

func (m *Manager) resume(ctx context.Context, r db.SessionRow) error {
	st, err := m.openStore(ctx, r)
	if err != nil {
		return err
	}
	dev, err := st.Container.GetFirstDevice(ctx)
	if err != nil {
		_ = st.Close()
		return err
	}
	if dev.ID == nil {
		_ = st.Close()
		m.destroy(ctx, r, "logged_out", "Linked device data was missing; please link again")
		return nil
	}
	s := newSession(m, r, st, m.newClient(dev, r.UserID))
	s.linked.Store(true)
	if err := s.ReloadMonitored(ctx); err != nil {
		m.log.Warn("monitored load failed", "tenant", logx.TenantTag(r.UserID), "err", err)
	}
	m.mu.Lock()
	if _, dup := m.sessions[r.UserID]; dup {
		m.mu.Unlock()
		s.close()
		return nil
	}
	m.sessions[r.UserID] = s
	m.mu.Unlock()
	return s.client.Connect()
}

// StartPairing begins linking a student's WhatsApp by QR code ("qr") or phone-number
// pairing code ("code"). Progress is delivered through the returned Pairing.
func (m *Manager) StartPairing(ctx context.Context, userID, method, phone string) (*Pairing, error) {
	if method != "qr" && method != "code" {
		return nil, fmt.Errorf("unknown pairing method")
	}
	if method == "code" && !phonePattern.MatchString(phone) {
		return nil, ErrBadPhone
	}

	m.mu.Lock()
	if existing := m.sessions[userID]; existing != nil {
		if existing.linked.Load() {
			m.mu.Unlock()
			return nil, ErrAlreadyLinked
		}
		delete(m.sessions, userID) // abandon the previous attempt
		m.mu.Unlock()
		existing.close()
	} else {
		m.mu.Unlock()
	}
	if prev, err := m.db.GetSession(ctx, userID); err == nil {
		if prev.Status == "linked" {
			return nil, ErrAlreadyLinked
		}
		m.destroy(ctx, *prev, "", "")
	} else if !errors.Is(err, db.ErrNotFound) {
		return nil, err
	}

	fileName, err := randomStoreName()
	if err != nil {
		return nil, err
	}
	key, err := seal.RandomKey(wastore.KeySize)
	if err != nil {
		return nil, err
	}
	wrapped, err := m.cfg.GatewayKEK.Wrap(key, "wastore", userID)
	if err != nil {
		return nil, err
	}
	row := db.SessionRow{UserID: userID, StoreFile: fileName, KEKID: m.cfg.GatewayKEK.ID, WrappedDEK: wrapped, Status: "pairing"}
	if err := m.db.InsertSession(ctx, row, m.cfg.InstanceID, leaseFor); err != nil {
		return nil, err
	}
	st, err := wastore.Open(ctx, m.cfg.StoreDir, fileName, key, logx.WhatsApp(m.waLogger(userID), "store", slog.LevelWarn))
	seal.Zero(key)
	if err != nil {
		m.destroy(ctx, row, "", "")
		return nil, err
	}

	s := newSession(m, row, st, m.newClient(st.Container.NewDevice(), userID))
	s.pairing = newPairing()
	s.history = newHistoryBuffer(m.cfg.HistoryTTL)

	pctx, cancel := context.WithTimeout(context.Background(), pairingTimeout)
	qrChan, err := s.client.GetQRChannel(pctx)
	if err != nil {
		cancel()
		s.close()
		m.destroy(ctx, row, "", "")
		return nil, err
	}
	if err := s.client.Connect(); err != nil {
		cancel()
		s.close()
		m.destroy(ctx, row, "", "")
		return nil, err
	}
	m.mu.Lock()
	m.sessions[userID] = s
	m.mu.Unlock()
	_ = m.db.SetLinkStatus(ctx, userID, "pairing", "", "", "")

	go m.runPairing(pctx, cancel, s, qrChan, method, phone)
	return s.pairing, nil
}

func (m *Manager) runPairing(ctx context.Context, cancel context.CancelFunc, s *Session, qrChan <-chan whatsmeow.QRChannelItem, method, phone string) {
	defer cancel()
	p := s.pairing
	codeSent := false
	for item := range qrChan {
		switch item.Event {
		case whatsmeow.QRChannelEventCode:
			if method == "qr" {
				p.publish(PairEvent{Type: "qr", Code: item.Code, Timeout: int(item.Timeout.Seconds())})
			} else if !codeSent {
				codeSent = true
				code, err := s.client.PairPhone(ctx, phone, true, whatsmeow.PairClientChrome, "Chrome (Linux)")
				if err != nil {
					s.log.Warn("pair phone failed", "err", logx.Redact(err.Error()))
					p.publish(PairEvent{Type: "error", Reason: "pair_code_failed"})
					m.abandon(s)
					return
				}
				p.publish(PairEvent{Type: "pair_code", Code: code})
			}
		case "success":
			p.publish(PairEvent{Type: "success"})
			return
		case "timeout":
			p.publish(PairEvent{Type: "timeout"})
			m.abandon(s)
			return
		case whatsmeow.QRChannelEventPasskeyRequest:
			// Passkey-protected accounts need a WebAuthn assertion for whatsapp.com,
			// which a third-party site cannot produce.
			p.publish(PairEvent{Type: "error", Reason: "passkey_required"})
			m.abandon(s)
			return
		case whatsmeow.QRChannelEventPasskeyResponse:
			// handled automatically by whatsmeow
		case "err-scanned-without-multidevice":
			p.publish(PairEvent{Type: "qr", Reason: "enable_multidevice"})
		default:
			reason := item.Event
			if item.Event == whatsmeow.QRChannelEventError {
				reason = "pairing_failed"
			}
			p.publish(PairEvent{Type: "error", Reason: reason})
			m.abandon(s)
			return
		}
	}
	if !s.linked.Load() {
		p.publish(PairEvent{Type: "timeout"})
		m.abandon(s)
	}
}

// abandon tears down an unfinished pairing attempt and its (empty) store.
func (m *Manager) abandon(s *Session) {
	if s.linked.Load() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	m.mu.Lock()
	if m.sessions[s.userID] == s {
		delete(m.sessions, s.userID)
	}
	m.mu.Unlock()
	s.close()
	m.destroy(ctx, s.row, "unlinked", "")
}

// Unlink logs the device out of WhatsApp (removing it from the phone's Linked devices)
// and crypto-shreds the stored credentials.
func (m *Manager) Unlink(ctx context.Context, userID string) error {
	m.mu.Lock()
	s := m.sessions[userID]
	delete(m.sessions, userID)
	m.mu.Unlock()
	if s != nil {
		if s.client.IsLoggedIn() {
			lctx, cancel := context.WithTimeout(ctx, 15*time.Second)
			if err := s.client.Logout(lctx); err != nil {
				s.log.Warn("remote logout failed; shredding locally anyway", "err", logx.Redact(err.Error()))
			}
			cancel()
		}
		s.close()
	}
	row, err := m.db.GetSession(ctx, userID)
	if errors.Is(err, db.ErrNotFound) {
		return m.db.SetLinkStatus(ctx, userID, "unlinked", "", "", "")
	} else if err != nil {
		return err
	}
	m.destroy(ctx, *row, "unlinked", "")
	return nil
}

// shred is used when WhatsApp itself ends the device (logout from the phone, etc.).
func (m *Manager) shred(s *Session, status, reason string) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	m.mu.Lock()
	if m.sessions[s.userID] == s {
		delete(m.sessions, s.userID)
	}
	m.mu.Unlock()
	s.close()
	m.destroy(ctx, s.row, status, reason)
}

// stopSession disconnects without deleting credentials (temporary bans, takeovers).
func (m *Manager) stopSession(s *Session, status, reason string) {
	m.mu.Lock()
	if m.sessions[s.userID] == s {
		delete(m.sessions, s.userID)
	}
	m.mu.Unlock()
	s.close()
	s.setStatus(status, reason)
}

// destroy deletes the store files and the wrapped key. Once the key row is gone the
// credentials are unrecoverable, even from backups of the store volume.
func (m *Manager) destroy(ctx context.Context, r db.SessionRow, status, reason string) {
	if err := wastore.Destroy(m.cfg.StoreDir, r.StoreFile); err != nil {
		m.log.Error("destroy store files failed", "tenant", logx.TenantTag(r.UserID), "err", err)
	}
	if err := m.db.DeleteSession(ctx, r.UserID); err != nil {
		m.log.Error("delete session row failed", "tenant", logx.TenantTag(r.UserID), "err", err)
	}
	if status != "" {
		if err := m.db.SetLinkStatus(ctx, r.UserID, status, "", "", reason); err != nil {
			m.log.Error("set link status failed", "tenant", logx.TenantTag(r.UserID), "err", err)
		}
	}
}

// Get returns the running session for a tenant, if any.
func (m *Manager) Get(userID string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[userID]
}

// Pairing returns the in-progress pairing for a tenant, if any.
func (m *Manager) Pairing(userID string) *Pairing {
	s := m.Get(userID)
	if s == nil {
		return nil
	}
	return s.pairing
}

type Status struct {
	Running   bool `json:"running"`
	Linked    bool `json:"linked"`
	Connected bool `json:"connected"`
	Pairing   bool `json:"pairing"`
}

func (m *Manager) Status(userID string) Status {
	s := m.Get(userID)
	if s == nil {
		return Status{}
	}
	return Status{
		Running:   true,
		Linked:    s.linked.Load(),
		Connected: s.client.IsConnected() && s.client.IsLoggedIn(),
		Pairing:   !s.linked.Load() && s.pairing != nil,
	}
}

func (m *Manager) leaseLoop(ctx context.Context) {
	t := time.NewTicker(leaseRenew)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		m.mu.Lock()
		held := make([]string, 0, len(m.sessions))
		for id := range m.sessions {
			held = append(held, id)
		}
		m.mu.Unlock()
		lost, err := m.db.RenewLeases(ctx, m.cfg.InstanceID, leaseFor, held)
		if err != nil {
			m.log.Error("lease renewal failed", "err", err)
			continue
		}
		for _, id := range lost {
			if s := m.Get(id); s != nil && s.linked.Load() {
				m.log.Warn("lease lost; stopping session", "tenant", logx.TenantTag(id))
				m.mu.Lock()
				delete(m.sessions, id)
				m.mu.Unlock()
				s.close()
			}
		}
		// Pick up sessions abandoned by a crashed instance.
		if err := m.claimAndResume(ctx); err != nil {
			m.log.Error("claim sessions failed", "err", err)
		}
	}
}

func (m *Manager) refreshLoop(ctx context.Context) {
	t := time.NewTicker(5 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		m.mu.Lock()
		list := make([]*Session, 0, len(m.sessions))
		for _, s := range m.sessions {
			list = append(list, s)
		}
		m.mu.Unlock()
		for _, s := range list {
			if !s.linked.Load() {
				continue
			}
			rctx, cancel := context.WithTimeout(ctx, 30*time.Second)
			if err := s.ReloadMonitored(rctx); err != nil {
				s.log.Warn("monitored refresh failed", "err", err)
			}
			cancel()
		}
	}
}

// Shutdown disconnects every session and releases leases so another instance can take over.
func (m *Manager) Shutdown(ctx context.Context) {
	m.mu.Lock()
	list := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		list = append(list, s)
	}
	m.sessions = map[string]*Session{}
	m.mu.Unlock()
	for _, s := range list {
		s.close()
	}
	if err := m.db.ReleaseLeases(ctx, m.cfg.InstanceID); err != nil {
		m.log.Error("release leases failed", "err", err)
	}
}

func randomStoreName() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b) + ".db", nil
}

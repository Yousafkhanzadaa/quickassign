package session

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"

	"github.com/quickassign/gateway/internal/db"
	"github.com/quickassign/gateway/internal/logx"
	"github.com/quickassign/gateway/internal/seal"
	"github.com/quickassign/gateway/internal/wastore"
)

var (
	ErrNoMedia    = errors.New("session: message has no downloadable media")
	ErrTooLarge   = errors.New("session: media exceeds size limit")
	ErrNotRunning = errors.New("session: not linked or not connected")
)

// Session is one student's linked WhatsApp device.
type Session struct {
	m      *Manager
	userID string
	row    db.SessionRow
	st     *wastore.Store
	client *whatsmeow.Client
	out    *outbound
	log    *slog.Logger

	mu         sync.RWMutex
	monitored  map[types.JID]bool
	admins     map[types.JID]adminSet
	contentKey []byte
	history    *historyBuffer
	pairing    *Pairing
	lastStatus time.Time

	linked    atomic.Bool
	stopped   atomic.Bool
	handlerID uint32
}

type adminSet struct {
	fetched time.Time
	users   map[types.JID]bool
}

func newSession(m *Manager, row db.SessionRow, st *wastore.Store, cli *whatsmeow.Client) *Session {
	s := &Session{
		m:         m,
		userID:    row.UserID,
		row:       row,
		st:        st,
		client:    cli,
		log:       m.log.With("tenant", logx.TenantTag(row.UserID)),
		monitored: map[types.JID]bool{},
		admins:    map[types.JID]adminSet{},
	}
	s.out = newOutbound(cli, func() (types.JID, types.JID) {
		id := cli.Store.ID
		if id == nil {
			return types.EmptyJID, types.EmptyJID
		}
		return *id, cli.Store.LID
	}, m.cfg.SendPerHour)
	s.handlerID = cli.AddEventHandler(s.handleEvent)
	return s
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

func (s *Session) handleEvent(raw any) {
	if s.stopped.Load() {
		return
	}
	switch evt := raw.(type) {
	case *events.Message:
		s.onMessage(evt)
	case *events.HistorySync:
		s.onHistorySync(evt)
	case *events.PairSuccess:
		s.onPairSuccess(evt)
	case *events.Connected:
		s.onConnected()
	case *events.LoggedOut:
		s.log.Warn("whatsapp logged out", "reason", evt.Reason.String(), "on_connect", evt.OnConnect)
		go s.m.shred(s, "logged_out", "WhatsApp ended this linked device")
	case *events.StreamReplaced:
		s.log.Warn("stream replaced by another connection; stopping")
		go s.m.stopSession(s, "error", "Another connection replaced this session")
	case *events.TemporaryBan:
		s.log.Error("whatsapp temporary ban", "code", int(evt.Code), "expire_s", int(evt.Expire.Seconds()))
		go s.m.stopSession(s, "temp_banned", evt.String())
	case *events.ConnectFailure:
		if evt.Reason.IsLoggedOut() {
			go s.m.shred(s, "logged_out", "WhatsApp ended this linked device")
			return
		}
		s.log.Error("connect failure", "reason", evt.Reason.String())
		s.setStatus("error", "connect failure: "+evt.Reason.String())
	case *events.ClientOutdated:
		s.log.Error("whatsmeow client outdated: upgrade the gateway")
		go s.m.stopSession(s, "error", "Gateway needs an update; we're on it")
	case *events.KeepAliveTimeout:
		s.log.Warn("keepalive timeout", "errors", evt.ErrorCount)
	case *events.UndecryptableMessage:
		s.log.Debug("undecryptable message", "unavailable", evt.IsUnavailable)
	}
}

func (s *Session) onMessage(evt *events.Message) {
	info := evt.Info
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	switch {
	case info.Chat.Server == types.GroupServer:
		if !s.isMonitored(info.Chat) {
			return // dropped at the edge: never stored, never logged
		}
		viewOnce := evt.IsViewOnce || evt.IsViewOnceV2 || evt.IsViewOnceV2Extension
		s.ingest(ctx, info, Normalize(evt.Message, viewOnce), false)

	case info.IsFromMe && s.out.isOwner(info.Chat):
		s.onSelfChat(ctx, info, evt.Message)
	}
	// Direct chats, other people's chats, statuses, channels: ignored entirely.
}

func (s *Session) ingest(ctx context.Context, info types.MessageInfo, n Normalized, backfill bool) {
	groupJID := info.Chat.String()
	if n.RevokeOf != "" {
		if err := s.m.db.MarkRevoked(ctx, s.userID, groupJID, n.RevokeOf); err != nil {
			s.log.Error("mark revoked failed", "err", err)
		}
		return
	}
	if n.Skip {
		return
	}
	waID := string(info.ID)
	isEdit := false
	if n.EditOf != "" {
		waID, isEdit = n.EditOf, true
	}

	key, err := s.getContentKey(ctx)
	if err != nil {
		s.log.Error("content key unavailable; dropping message", "err", err)
		return
	}
	record := groupJID + ":" + waID
	sender := s.canonicalSender(ctx, info)
	senderHash := seal.SenderHash(s.m.pepper, s.userID, sender.String())

	body, err1 := sealOpt(key, []byte(n.Text), "msg.body", s.userID, record)
	desc, err2 := sealOpt(key, n.MediaDesc, "msg.media", s.userID, record)
	fname, err3 := sealOpt(key, []byte(n.FileName), "msg.filename", s.userID, record)
	name, err4 := sealOpt(key, []byte(info.PushName), "sender.name", s.userID, groupJID+":"+senderHash)
	if err := errors.Join(err1, err2, err3, err4); err != nil {
		s.log.Error("encrypt failed", "err", err)
		return
	}

	_, err = s.m.db.IngestMessage(ctx, db.InboundMessage{
		ID:               uuid.New(),
		UserID:           s.userID,
		GroupJID:         groupJID,
		WAMessageID:      waID,
		SenderHash:       senderHash,
		SenderIsAdmin:    s.isAdmin(info.Chat, sender, info.Sender, info.SenderAlt),
		SenderNameEnc:    name,
		SentAt:           info.Timestamp,
		Kind:             n.Kind,
		BodyEnc:          body,
		QuotedID:         n.QuotedID,
		MediaDescEnc:     desc,
		MediaMime:        n.MediaMime,
		MediaSize:        n.MediaSize,
		MediaFilenameEnc: fname,
		IsEdit:           isEdit,
		IsBackfill:       backfill,
	})
	if err != nil {
		s.log.Error("ingest failed", "err", err)
	}
}

// onSelfChat forwards commands typed in the student's own chat. Personal notes stay
// private: only messages that reply to something, or start with "qa", are forwarded.
func (s *Session) onSelfChat(ctx context.Context, info types.MessageInfo, msg *waE2E.Message) {
	if s.out.wasSentByUs(info.ID) {
		return
	}
	text, quoted := msg.GetConversation(), ""
	if et := msg.GetExtendedTextMessage(); et != nil {
		text, quoted = et.GetText(), et.GetContextInfo().GetStanzaID()
	}
	text = strings.TrimSpace(text)
	if text == "" || utf8.RuneCountInString(text) > 300 {
		return
	}
	if quoted == "" && !hasCommandPrefix(text) {
		return
	}
	key, err := s.getContentKey(ctx)
	if err != nil {
		s.log.Error("content key unavailable; dropping command", "err", err)
		return
	}
	id := uuid.New()
	enc, err := seal.Seal(key, []byte(text), seal.AAD("cmd.text", s.userID, id.String()))
	if err != nil {
		return
	}
	if err := s.m.db.IngestCommand(ctx, id, s.userID, string(info.ID), enc, quoted); err != nil {
		s.log.Error("command ingest failed", "err", err)
	}
}

func hasCommandPrefix(text string) bool {
	t := strings.ToLower(text)
	return t == "qa" || strings.HasPrefix(t, "qa ") || strings.HasPrefix(t, "qa:") || strings.HasPrefix(t, "/qa")
}

func (s *Session) onHistorySync(evt *events.HistorySync) {
	if evt.Data == nil || !s.history.active() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cutoff := time.Now().AddDate(0, 0, -s.m.cfg.HistoryDays)
	for _, conv := range evt.Data.GetConversations() {
		chat, err := types.ParseJID(conv.GetID())
		if err != nil || chat.Server != types.GroupServer {
			continue // only group chats are ever considered
		}
		monitored := s.isMonitored(chat)
		for _, hm := range conv.GetMessages() {
			parsed, err := s.client.ParseWebMessage(chat, hm.GetMessage())
			if err != nil || parsed.Info.Timestamp.Before(cutoff) {
				continue
			}
			n := Normalize(parsed.Message, parsed.IsViewOnce)
			if n.Skip || n.RevokeOf != "" || n.EditOf != "" {
				continue
			}
			if monitored {
				s.ingest(ctx, parsed.Info, n, true)
			} else {
				s.history.add(chat, bufferedMsg{info: parsed.Info, norm: n})
			}
		}
	}
}

func (s *Session) onPairSuccess(evt *events.PairSuccess) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	s.linked.Store(true)
	if err := s.m.db.SetSessionStatus(ctx, s.userID, "linked"); err != nil {
		s.log.Error("persist linked status failed", "err", err)
	}
	if err := s.m.db.SetLinkStatus(ctx, s.userID, "linked", s.m.cfg.DeviceOS, maskPhone(evt.ID.User), ""); err != nil {
		s.log.Error("set link status failed", "err", err)
	}
	s.log.Info("whatsapp linked")
}

func (s *Session) onConnected() {
	if !s.linked.Load() && s.client.Store.ID != nil {
		s.linked.Store(true)
	}
	s.mu.Lock()
	refresh := time.Since(s.lastStatus) > 10*time.Minute
	if refresh {
		s.lastStatus = time.Now()
	}
	s.mu.Unlock()
	if refresh {
		s.setStatus("linked", "")
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			if _, err := s.RefreshGroups(ctx); err != nil {
				s.log.Warn("group refresh failed", "err", err)
			}
			if err := s.ReloadMonitored(ctx); err != nil {
				s.log.Warn("monitored reload failed", "err", err)
			}
		}()
	}
}

func (s *Session) setStatus(status, msg string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := s.m.db.SetLinkStatus(ctx, s.userID, status, "", "", msg); err != nil {
		s.log.Error("set link status failed", "err", err)
	}
}

// ---------------------------------------------------------------------------
// Operations requested over the internal API
// ---------------------------------------------------------------------------

func (s *Session) ready() error {
	if s.stopped.Load() || !s.linked.Load() || !s.client.IsConnected() || !s.client.IsLoggedIn() {
		return ErrNotRunning
	}
	return nil
}

// RefreshGroups pulls the student's group list from WhatsApp into the dashboard.
func (s *Session) RefreshGroups(ctx context.Context) (int, error) {
	if err := s.ready(); err != nil {
		return 0, err
	}
	groups, err := s.client.GetJoinedGroups(ctx)
	if err != nil {
		return 0, err
	}
	rows := make([]db.Group, 0, len(groups))
	for _, g := range groups {
		count := g.ParticipantCount
		if count == 0 {
			count = len(g.Participants)
		}
		parent := ""
		if !g.LinkedParentJID.IsEmpty() {
			parent = g.LinkedParentJID.String()
		}
		rows = append(rows, db.Group{
			JID: g.JID.String(), Name: g.Name, IsAnnouncement: g.IsAnnounce,
			IsParent: g.IsParent, ParentJID: parent, Participants: count,
		})
		s.cacheAdmins(g.JID, g.Participants)
	}
	return s.m.db.UpsertGroups(ctx, s.userID, rows)
}

// ReloadMonitored re-reads which groups the student selected, and backfills newly
// selected groups from the in-memory history buffer.
func (s *Session) ReloadMonitored(ctx context.Context) error {
	jids, err := s.m.db.ListMonitored(ctx, s.userID)
	if err != nil {
		return err
	}
	next := make(map[types.JID]bool, len(jids))
	for _, j := range jids {
		if jid, err := types.ParseJID(j); err == nil && jid.Server == types.GroupServer {
			next[jid] = true
		}
	}
	s.mu.Lock()
	prev := s.monitored
	s.monitored = next
	s.mu.Unlock()

	for jid := range next {
		if prev[jid] {
			continue
		}
		for _, b := range s.history.take(jid) {
			s.ingest(ctx, b.info, b.norm, true)
		}
		if err := s.ready(); err == nil && s.needsAdminRefresh(jid) {
			if info, err := s.client.GetGroupInfo(ctx, jid); err == nil {
				s.cacheAdmins(jid, info.Participants)
			}
		}
	}
	return nil
}

func (s *Session) SendSelfText(ctx context.Context, text string) (string, error) {
	if err := s.ready(); err != nil {
		return "", err
	}
	id, err := s.out.sendToSelf(ctx, &waE2E.Message{Conversation: proto.String(text)})
	return string(id), err
}

func (s *Session) SendSelfDocument(ctx context.Context, fileName, mime, caption string, data []byte) (string, error) {
	if err := s.ready(); err != nil {
		return "", err
	}
	up, err := s.client.Upload(ctx, data, whatsmeow.MediaDocument)
	if err != nil {
		return "", fmt.Errorf("upload: %w", err)
	}
	id, err := s.out.sendToSelf(ctx, &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{
		URL:           proto.String(up.URL),
		DirectPath:    proto.String(up.DirectPath),
		MediaKey:      up.MediaKey,
		FileEncSHA256: up.FileEncSHA256,
		FileSHA256:    up.FileSHA256,
		FileLength:    proto.Uint64(up.FileLength),
		Mimetype:      proto.String(mime),
		FileName:      proto.String(fileName),
		Title:         proto.String(fileName),
		Caption:       proto.String(caption),
	}})
	return string(id), err
}

// FetchMedia downloads the attachment of a stored group message on demand.
func (s *Session) FetchMedia(ctx context.Context, messageID uuid.UUID) ([]byte, string, error) {
	if err := s.ready(); err != nil {
		return nil, "", err
	}
	d, err := s.m.db.GetMediaDescriptor(ctx, s.userID, messageID)
	if err != nil {
		return nil, "", err
	}
	if len(d.DescEnc) == 0 {
		return nil, "", ErrNoMedia
	}
	key, err := s.getContentKey(ctx)
	if err != nil {
		return nil, "", err
	}
	raw, err := seal.Open(key, d.DescEnc, seal.AAD("msg.media", s.userID, d.GroupJID+":"+d.WAMessageID))
	if err != nil {
		return nil, "", err
	}
	doc, img, err := MediaFromDescriptor(raw)
	if err != nil {
		return nil, "", err
	}
	var dl whatsmeow.DownloadableMessage
	var size uint64
	switch {
	case doc != nil:
		dl, size = doc, doc.GetFileLength()
	case img != nil:
		dl, size = img, img.GetFileLength()
	default:
		return nil, "", ErrNoMedia
	}
	if int64(size) > s.m.cfg.MediaMaxBytes {
		return nil, "", ErrTooLarge
	}
	data, err := s.client.Download(ctx, dl)
	if err != nil {
		return nil, "", fmt.Errorf("download: %w", err)
	}
	if int64(len(data)) > s.m.cfg.MediaMaxBytes {
		return nil, "", ErrTooLarge
	}
	return data, d.Mime, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func (s *Session) isMonitored(jid types.JID) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.monitored[jid]
}

// canonicalSender prefers the LID form so the same person hashes the same way whether
// a message arrived with phone-number or LID addressing.
func (s *Session) canonicalSender(ctx context.Context, info types.MessageInfo) types.JID {
	sender := info.Sender.ToNonAD()
	if sender.Server == types.HiddenUserServer {
		return sender
	}
	if alt := info.SenderAlt.ToNonAD(); alt.Server == types.HiddenUserServer {
		return alt
	}
	if sender.Server == types.DefaultUserServer && s.client.Store.LIDs != nil {
		if lid, err := s.client.Store.LIDs.GetLIDForPN(ctx, sender); err == nil && !lid.IsEmpty() {
			return lid.ToNonAD()
		}
	}
	return sender
}

func (s *Session) cacheAdmins(group types.JID, participants []types.GroupParticipant) {
	set := adminSet{fetched: time.Now(), users: map[types.JID]bool{}}
	for _, p := range participants {
		if !p.IsAdmin && !p.IsSuperAdmin {
			continue
		}
		for _, j := range []types.JID{p.JID, p.LID, p.PhoneNumber} {
			if !j.IsEmpty() {
				set.users[j.ToNonAD()] = true
			}
		}
	}
	s.mu.Lock()
	s.admins[group] = set
	s.mu.Unlock()
}

func (s *Session) needsAdminRefresh(group types.JID) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	a, ok := s.admins[group]
	return !ok || time.Since(a.fetched) > time.Hour
}

func (s *Session) isAdmin(group types.JID, ids ...types.JID) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	a, ok := s.admins[group]
	if !ok {
		return false
	}
	for _, j := range ids {
		if !j.IsEmpty() && a.users[j.ToNonAD()] {
			return true
		}
	}
	return false
}

func (s *Session) getContentKey(ctx context.Context) ([]byte, error) {
	s.mu.RLock()
	k := s.contentKey
	s.mu.RUnlock()
	if k != nil {
		return k, nil
	}
	appKEK := s.m.cfg.AppKEK
	kekID, wrapped, err := s.m.db.GetContentKey(ctx, s.userID)
	if errors.Is(err, db.ErrNotFound) {
		dek, err := seal.RandomKey(seal.KeySize)
		if err != nil {
			return nil, err
		}
		w, err := appKEK.Wrap(dek, "content", s.userID)
		if err != nil {
			return nil, err
		}
		if err := s.m.db.PutContentKey(ctx, s.userID, appKEK.ID, w); err != nil {
			return nil, err
		}
		kekID, wrapped, err = s.m.db.GetContentKey(ctx, s.userID) // re-read: another service may have won the race
		if err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}
	if kekID != appKEK.ID {
		return nil, fmt.Errorf("content key wrapped with unknown KEK %q", kekID)
	}
	dek, err := appKEK.Unwrap(wrapped, "content", s.userID)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.contentKey = dek
	s.mu.Unlock()
	return dek, nil
}

func sealOpt(key, plaintext []byte, purpose, tenant, record string) ([]byte, error) {
	if len(plaintext) == 0 {
		return nil, nil
	}
	return seal.Seal(key, plaintext, seal.AAD(purpose, tenant, record))
}

// maskPhone keeps only the country prefix and last two digits: 923001234567 -> +92•••••••67.
func maskPhone(digits string) string {
	if len(digits) < 6 {
		return ""
	}
	return "+" + digits[:2] + strings.Repeat("•", len(digits)-4) + digits[len(digits)-2:]
}

// close releases the client and store without touching persisted state.
func (s *Session) close() {
	if !s.stopped.CompareAndSwap(false, true) {
		return
	}
	s.client.RemoveEventHandler(s.handlerID)
	s.client.Disconnect()
	s.history.clear()
	s.mu.Lock()
	if s.contentKey != nil {
		seal.Zero(s.contentKey)
		s.contentKey = nil
	}
	s.mu.Unlock()
	if err := s.st.Close(); err != nil {
		s.log.Warn("store close failed", "err", err)
	}
}

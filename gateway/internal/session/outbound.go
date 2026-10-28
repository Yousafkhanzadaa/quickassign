package session

import (
	"context"
	"errors"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
)

// This file is the ONLY place in the gateway allowed to call SendMessage
// (enforced by TestOnlyOutboundSends). Every send goes to the student's own
// "Message yourself" chat; the recipient is derived from the device store, never
// taken from a caller, and is re-checked immediately before sending.

var (
	ErrNotLoggedIn         = errors.New("outbound: session is not logged in")
	ErrRecipientNotAllowed = errors.New("outbound: recipient is not the account owner")
	ErrRateLimited         = errors.New("outbound: send rate limit reached")
)

type messageSender interface {
	SendMessage(ctx context.Context, to types.JID, message *waE2E.Message, extra ...whatsmeow.SendRequestExtra) (whatsmeow.SendResponse, error)
}

type outbound struct {
	sender  messageSender
	ownJIDs func() (pn types.JID, lid types.JID)
	limiter *windowLimiter
	sent    *recentIDs
}

func newOutbound(sender messageSender, ownJIDs func() (types.JID, types.JID), perHour int) *outbound {
	return &outbound{
		sender:  sender,
		ownJIDs: ownJIDs,
		limiter: newWindowLimiter(perHour, time.Hour),
		sent:    newRecentIDs(512),
	}
}

// selfChat returns the account owner's own chat JID.
func (o *outbound) selfChat() (types.JID, error) {
	pn, _ := o.ownJIDs()
	pn = pn.ToNonAD()
	if pn.User == "" || pn.Server != types.DefaultUserServer {
		return types.EmptyJID, ErrNotLoggedIn
	}
	return pn, nil
}

// isOwner reports whether jid is the account owner (phone-number or LID form).
func (o *outbound) isOwner(jid types.JID) bool {
	pn, lid := o.ownJIDs()
	j := jid.ToNonAD()
	if j.IsEmpty() {
		return false
	}
	return (!pn.IsEmpty() && j == pn.ToNonAD()) || (!lid.IsEmpty() && j == lid.ToNonAD())
}

func (o *outbound) sendToSelf(ctx context.Context, msg *waE2E.Message) (types.MessageID, error) {
	to, err := o.selfChat()
	if err != nil {
		return "", err
	}
	// Belt and braces: re-validate the final recipient right before the network call.
	if to.Server != types.DefaultUserServer || !o.isOwner(to) {
		return "", ErrRecipientNotAllowed
	}
	if !o.limiter.Allow() {
		return "", ErrRateLimited
	}
	resp, err := o.sender.SendMessage(ctx, to, msg)
	if err != nil {
		return "", err
	}
	o.sent.Add(resp.ID)
	return resp.ID, nil
}

// wasSentByUs reports whether a message ID in the self chat is one of our own sends.
func (o *outbound) wasSentByUs(id types.MessageID) bool { return o.sent.Contains(id) }

// windowLimiter allows at most n events per sliding window.
type windowLimiter struct {
	mu     sync.Mutex
	n      int
	window time.Duration
	events []time.Time
	now    func() time.Time
}

func newWindowLimiter(n int, window time.Duration) *windowLimiter {
	return &windowLimiter{n: n, window: window, now: time.Now}
}

func (l *windowLimiter) Allow() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	cutoff := now.Add(-l.window)
	keep := l.events[:0]
	for _, t := range l.events {
		if t.After(cutoff) {
			keep = append(keep, t)
		}
	}
	l.events = keep
	if len(l.events) >= l.n {
		return false
	}
	l.events = append(l.events, now)
	return true
}

// recentIDs is a small bounded set of recently sent message IDs.
type recentIDs struct {
	mu    sync.Mutex
	cap   int
	order []types.MessageID
	set   map[types.MessageID]struct{}
}

func newRecentIDs(capacity int) *recentIDs {
	return &recentIDs{cap: capacity, set: make(map[types.MessageID]struct{}, capacity)}
}

func (r *recentIDs) Add(id types.MessageID) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.set[id]; ok {
		return
	}
	if len(r.order) >= r.cap {
		delete(r.set, r.order[0])
		r.order = r.order[1:]
	}
	r.order = append(r.order, id)
	r.set[id] = struct{}{}
}

func (r *recentIDs) Contains(id types.MessageID) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.set[id]
	return ok
}

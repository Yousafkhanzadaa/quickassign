package session

import (
	"sync"
	"time"

	"go.mau.fi/whatsmeow/types"
)

// historyBuffer holds recent group messages from the initial history sync, in memory
// only, until the student picks which groups to monitor (usually within minutes of
// linking). Messages for groups that are never selected are discarded unread when the
// buffer expires; nothing from unselected groups ever reaches disk or the database.
type historyBuffer struct {
	mu          sync.Mutex
	until       time.Time
	perGroup    map[types.JID][]bufferedMsg
	total       int
	maxPerGroup int
	maxTotal    int
}

type bufferedMsg struct {
	info types.MessageInfo
	norm Normalized
}

func newHistoryBuffer(ttl time.Duration) *historyBuffer {
	return &historyBuffer{
		until:       time.Now().Add(ttl),
		perGroup:    make(map[types.JID][]bufferedMsg),
		maxPerGroup: 300,
		maxTotal:    5000,
	}
}

func (h *historyBuffer) active() bool {
	if h == nil {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if time.Now().After(h.until) {
		h.perGroup = nil
		h.total = 0
		return false
	}
	return true
}

func (h *historyBuffer) add(group types.JID, m bufferedMsg) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.perGroup == nil || h.total >= h.maxTotal || len(h.perGroup[group]) >= h.maxPerGroup {
		return
	}
	h.perGroup[group] = append(h.perGroup[group], m)
	h.total++
}

// take removes and returns the buffered messages for a group.
func (h *historyBuffer) take(group types.JID) []bufferedMsg {
	if h == nil {
		return nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	msgs := h.perGroup[group]
	delete(h.perGroup, group)
	h.total -= len(msgs)
	return msgs
}

func (h *historyBuffer) clear() {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.perGroup = nil
	h.total = 0
	h.until = time.Time{}
}

package session

import "sync"

// PairEvent is streamed to the dashboard while a student links WhatsApp.
type PairEvent struct {
	Type    string `json:"type"` // qr | pair_code | success | error | timeout
	Code    string `json:"code,omitempty"`
	Timeout int    `json:"timeout_s,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

// Pairing fans pairing events out to any number of SSE subscribers and replays the
// latest state to late subscribers (e.g. after a page refresh).
type Pairing struct {
	mu     sync.Mutex
	last   []PairEvent
	subs   map[chan PairEvent]struct{}
	closed bool
}

func newPairing() *Pairing {
	return &Pairing{subs: make(map[chan PairEvent]struct{})}
}

func (p *Pairing) publish(e PairEvent) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return
	}
	// Keep only the newest code/QR plus terminal events for replay.
	if e.Type == "qr" || e.Type == "pair_code" {
		kept := p.last[:0]
		for _, old := range p.last {
			if old.Type != e.Type {
				kept = append(kept, old)
			}
		}
		p.last = kept
	}
	p.last = append(p.last, e)
	for ch := range p.subs {
		select {
		case ch <- e:
		default: // slow subscriber; it will get the replay on reconnect
		}
	}
	if e.Type == "success" || e.Type == "error" || e.Type == "timeout" {
		p.closed = true
		for ch := range p.subs {
			close(ch)
		}
		p.subs = nil
	}
}

// Subscribe returns past events plus a channel of future ones. The channel is closed
// when pairing ends. Call cancel when the subscriber goes away.
func (p *Pairing) Subscribe() (replay []PairEvent, ch <-chan PairEvent, cancel func()) {
	p.mu.Lock()
	defer p.mu.Unlock()
	replay = append([]PairEvent(nil), p.last...)
	c := make(chan PairEvent, 8)
	if p.closed {
		close(c)
		return replay, c, func() {}
	}
	p.subs[c] = struct{}{}
	return replay, c, func() {
		p.mu.Lock()
		defer p.mu.Unlock()
		if _, ok := p.subs[c]; ok {
			delete(p.subs, c)
			close(c)
		}
	}
}

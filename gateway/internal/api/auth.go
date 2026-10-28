// Package api is the gateway's internal HTTP API. It must only be reachable on the private
// service network; every request is additionally authenticated with a per-service HMAC.
package api

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Signature scheme (mirrored in packages/core/src/gateway-client.ts):
//
//	X-QA-Service:   web | worker
//	X-QA-Timestamp: unix seconds
//	X-QA-Nonce:     32 hex chars, single use
//	X-QA-Signature: hex(HMAC-SHA256(secret, "v1\n" + service + "\n" + ts + "\n" + nonce + "\n" +
//	                                     METHOD + "\n" + path?query + "\n" + hex(sha256(body))))
const (
	maxSkew  = 60 * time.Second
	nonceTTL = 2 * maxSkew
)

var errUnauthorized = errors.New("unauthorized")

type authenticator struct {
	secrets map[string][]byte
	now     func() time.Time

	mu     sync.Mutex
	nonces map[string]time.Time
}

func newAuthenticator(secrets map[string][]byte) *authenticator {
	return &authenticator{secrets: secrets, now: time.Now, nonces: map[string]time.Time{}}
}

func canonical(service, ts, nonce, method, uri string, body []byte) []byte {
	sum := sha256.Sum256(body)
	return []byte("v1\n" + service + "\n" + ts + "\n" + nonce + "\n" + method + "\n" + uri + "\n" + hex.EncodeToString(sum[:]))
}

// Sign is used by tests and tooling; production clients live in packages/core.
func Sign(secret []byte, service, ts, nonce, method, uri string, body []byte) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write(canonical(service, ts, nonce, method, uri, body))
	return hex.EncodeToString(mac.Sum(nil))
}

// verify authenticates r, reading (at most maxBody bytes of) its body, and returns the
// calling service. The body is replaced so handlers can read it again.
func (a *authenticator) verify(r *http.Request, maxBody int64) (string, error) {
	service := r.Header.Get("X-QA-Service")
	secret, ok := a.secrets[service]
	if !ok || len(secret) == 0 {
		return "", errUnauthorized
	}
	ts := r.Header.Get("X-QA-Timestamp")
	nonce := r.Header.Get("X-QA-Nonce")
	sig, err := hex.DecodeString(r.Header.Get("X-QA-Signature"))
	if err != nil || len(sig) != sha256.Size || len(nonce) != 32 {
		return "", errUnauthorized
	}
	if _, err := hex.DecodeString(nonce); err != nil {
		return "", errUnauthorized
	}
	sec, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return "", errUnauthorized
	}
	now := a.now()
	if d := now.Sub(time.Unix(sec, 0)); d > maxSkew || d < -maxSkew {
		return "", errUnauthorized
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil {
		return "", err
	}
	if int64(len(body)) > maxBody {
		return "", errTooLarge
	}
	r.Body = io.NopCloser(bytes.NewReader(body))

	mac := hmac.New(sha256.New, secret)
	mac.Write(canonical(service, ts, nonce, r.Method, r.URL.RequestURI(), body))
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return "", errUnauthorized
	}

	// Replay protection: each nonce is accepted once within the validity window.
	a.mu.Lock()
	defer a.mu.Unlock()
	for n, t := range a.nonces {
		if now.Sub(t) > nonceTTL {
			delete(a.nonces, n)
		}
	}
	if _, seen := a.nonces[service+":"+nonce]; seen {
		return "", errUnauthorized
	}
	a.nonces[service+":"+nonce] = now
	return service, nil
}

var errTooLarge = errors.New("request body too large")

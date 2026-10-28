package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

var testSecrets = map[string][]byte{
	"web":    []byte("web-secret-web-secret-web-secret-123"),
	"worker": []byte("worker-secret-worker-secret-worker-1"),
}

func signedRequest(t *testing.T, service, method, uri, body string, ts time.Time, nonce string) *http.Request {
	t.Helper()
	tsStr := strconv.FormatInt(ts.Unix(), 10)
	r := httptest.NewRequest(method, uri, strings.NewReader(body))
	r.Header.Set("X-QA-Service", service)
	r.Header.Set("X-QA-Timestamp", tsStr)
	r.Header.Set("X-QA-Nonce", nonce)
	r.Header.Set("X-QA-Signature", Sign(testSecrets[service], service, tsStr, nonce, method, uri, []byte(body)))
	return r
}

func TestVerifyAcceptsValidAndRejectsReplay(t *testing.T) {
	a := newAuthenticator(testSecrets)
	now := time.Now()
	nonce := strings.Repeat("a", 32)
	req := signedRequest(t, "worker", "POST", "/v1/tenants/abc12345/self/text", `{"text":"hi"}`, now, nonce)
	svc, err := a.verify(req, 1<<20)
	if err != nil || svc != "worker" {
		t.Fatalf("valid request rejected: %v", err)
	}
	b, _ := io.ReadAll(req.Body)
	if string(b) != `{"text":"hi"}` {
		t.Fatal("body must be readable after verification")
	}
	replay := signedRequest(t, "worker", "POST", "/v1/tenants/abc12345/self/text", `{"text":"hi"}`, now, nonce)
	if _, err := a.verify(replay, 1<<20); err == nil {
		t.Fatal("replayed nonce must be rejected")
	}
}

func TestVerifyRejectsTampering(t *testing.T) {
	a := newAuthenticator(testSecrets)
	now := time.Now()
	cases := map[string]func() *http.Request{
		"wrong service secret": func() *http.Request {
			r := signedRequest(t, "web", "POST", "/x", "{}", now, strings.Repeat("b", 32))
			r.Header.Set("X-QA-Service", "worker")
			return r
		},
		"body changed": func() *http.Request {
			r := signedRequest(t, "web", "POST", "/x", `{"a":1}`, now, strings.Repeat("c", 32))
			r.Body = io.NopCloser(strings.NewReader(`{"a":2}`))
			return r
		},
		"path changed": func() *http.Request {
			r := signedRequest(t, "web", "POST", "/v1/tenants/aaa/link", "{}", now, strings.Repeat("d", 32))
			r.URL.Path = "/v1/tenants/bbb/link"
			return r
		},
		"too old": func() *http.Request {
			return signedRequest(t, "web", "GET", "/x", "", now.Add(-2*time.Minute), strings.Repeat("e", 32))
		},
		"from the future": func() *http.Request {
			return signedRequest(t, "web", "GET", "/x", "", now.Add(2*time.Minute), strings.Repeat("f", 32))
		},
		"unknown service": func() *http.Request {
			r := signedRequest(t, "web", "GET", "/x", "", now, strings.Repeat("1", 32))
			r.Header.Set("X-QA-Service", "admin")
			return r
		},
		"short nonce": func() *http.Request {
			return signedRequest(t, "web", "GET", "/x", "", now, "abc")
		},
		"bad signature hex": func() *http.Request {
			r := signedRequest(t, "web", "GET", "/x", "", now, strings.Repeat("2", 32))
			r.Header.Set("X-QA-Signature", "zz")
			return r
		},
	}
	for name, mk := range cases {
		if _, err := a.verify(mk(), 1<<20); err == nil {
			t.Errorf("%s: expected rejection", name)
		}
	}
}

func TestVerifyEnforcesBodyLimit(t *testing.T) {
	a := newAuthenticator(testSecrets)
	r := signedRequest(t, "web", "POST", "/x", strings.Repeat("x", 2048), time.Now(), strings.Repeat("9", 32))
	if _, err := a.verify(r, 1024); err != errTooLarge {
		t.Fatalf("got %v, want errTooLarge", err)
	}
}

// Same vector as packages/core/src/gateway-client.test.ts: proves the TypeScript signer
// and this verifier agree byte for byte.
func TestCrossLanguageSignature(t *testing.T) {
	got := Sign([]byte("test-secret-0123456789abcdef0123456789"), "worker", "1700000000",
		"00112233445566778899aabbccddeeff", "POST", "/v1/tenants/abcdefgh/self/text", []byte(`{"text":"hi"}`))
	if got != "6413f24448ee332396dde4133c174e64d8774bf502117ff4aef46173716107c1" {
		t.Fatalf("signature mismatch: %s", got)
	}
}

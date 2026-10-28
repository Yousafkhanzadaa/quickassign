package seal

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"testing"
)

func testKEK(t *testing.T) *KEK {
	t.Helper()
	k, err := ParseKEK("test-v1", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, KeySize)))
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func TestSealOpenRoundTrip(t *testing.T) {
	key, _ := RandomKey(KeySize)
	aad := AAD("msg.body", "user-1", "rec-1")
	ct, err := Seal(key, []byte("Assignment 3 due Monday"), aad)
	if err != nil {
		t.Fatal(err)
	}
	if ct[0] != formatVersion || len(ct) != 1+12+len("Assignment 3 due Monday")+16 {
		t.Fatalf("unexpected sealed layout, len=%d", len(ct))
	}
	pt, err := Open(key, ct, aad)
	if err != nil || string(pt) != "Assignment 3 due Monday" {
		t.Fatalf("round trip failed: %v %q", err, pt)
	}
}

func TestOpenRejectsWrongBinding(t *testing.T) {
	key, _ := RandomKey(KeySize)
	ct, _ := Seal(key, []byte("secret"), AAD("msg.body", "user-1", "rec-1"))

	for name, aad := range map[string][]byte{
		"other tenant":  AAD("msg.body", "user-2", "rec-1"),
		"other record":  AAD("msg.body", "user-1", "rec-2"),
		"other purpose": AAD("blob", "user-1", "rec-1"),
	} {
		if _, err := Open(key, ct, aad); err != ErrDecrypt {
			t.Errorf("%s: expected ErrDecrypt, got %v", name, err)
		}
	}
	tampered := bytes.Clone(ct)
	tampered[len(tampered)-1] ^= 1
	if _, err := Open(key, tampered, AAD("msg.body", "user-1", "rec-1")); err != ErrDecrypt {
		t.Errorf("tampered: expected ErrDecrypt, got %v", err)
	}
	if _, err := Open(key, ct[:10], nil); err != ErrDecrypt {
		t.Errorf("truncated: expected ErrDecrypt, got %v", err)
	}
}

func TestWrapUnwrap(t *testing.T) {
	k := testKEK(t)
	dek, _ := RandomKey(64)
	w, err := k.Wrap(dek, "wastore", "user-1")
	if err != nil {
		t.Fatal(err)
	}
	got, err := k.Unwrap(w, "wastore", "user-1")
	if err != nil || !bytes.Equal(got, dek) {
		t.Fatalf("unwrap failed: %v", err)
	}
	if _, err := k.Unwrap(w, "content", "user-1"); err == nil {
		t.Fatal("unwrap with wrong purpose must fail")
	}
	if _, err := k.Unwrap(w, "wastore", "user-2"); err == nil {
		t.Fatal("unwrap for wrong tenant must fail")
	}
}

func TestParseKEKValidation(t *testing.T) {
	if _, err := ParseKEK("x", "not base64!!"); err == nil {
		t.Error("expected error for bad base64")
	}
	if _, err := ParseKEK("x", base64.StdEncoding.EncodeToString([]byte("short"))); err == nil {
		t.Error("expected error for short key")
	}
	if _, err := ParseKEK("", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32))); err == nil {
		t.Error("expected error for empty id")
	}
}

func TestSenderHashIsPerTenant(t *testing.T) {
	pepper, err := testKEK(t).DeriveSubkey("qa/v1/sender-pepper")
	if err != nil {
		t.Fatal(err)
	}
	a := SenderHash(pepper, "tenant-a", "123@lid")
	b := SenderHash(pepper, "tenant-b", "123@lid")
	if a == b {
		t.Fatal("same sender must hash differently per tenant")
	}
	if a != SenderHash(pepper, "tenant-a", "123@lid") {
		t.Fatal("hash must be deterministic")
	}
	if len(a) != 32 {
		t.Fatalf("expected 32 hex chars, got %d", len(a))
	}
}

// Cross-language vector: packages/core/src/seal.test.ts decrypts this exact value,
// proving the Go and TypeScript implementations agree on the wire format.
func TestCrossLanguageVector(t *testing.T) {
	key := bytes.Repeat([]byte{0x11}, KeySize)
	sealed, _ := hex.DecodeString(crossVectorHex)
	pt, err := Open(key, sealed, AAD("msg.body", "tenant-x", "record-y"))
	if err != nil {
		t.Fatalf("cross-language vector failed: %v", err)
	}
	if string(pt) != "hello from typescript" {
		t.Fatalf("unexpected plaintext %q", pt)
	}
}

// Produced with Node's crypto (AES-256-GCM, key 0x11*32, nonce 0x22*12); the same
// vector is asserted in packages/core/src/seal.test.ts.
const crossVectorHex = "01" + "222222222222222222222222" +
	"7f926b25afeff92d8a52fe4831d68ca67ce1a4921ee3c808d3e2cd5775c877c5baa20e14b6"

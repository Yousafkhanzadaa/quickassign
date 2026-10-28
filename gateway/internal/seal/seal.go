// Package seal implements the envelope encryption shared by every QuickAssign service.
//
// Wire format (must stay byte-compatible with packages/core/src/seal.ts):
//
//	sealed = 0x01 || nonce (12 bytes) || AES-256-GCM ciphertext || tag (16 bytes)
//
// Additional authenticated data binds each ciphertext to what it is and whose it is:
//
//	aad = "qa/v1/" + purpose + "/" + tenant + "/" + record
//
// so a ciphertext copied into another row, tenant or column fails to decrypt.
package seal

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

const (
	formatVersion byte = 0x01
	nonceSize          = 12
	// KeySize is the size of AES-256 keys used for KEKs and content DEKs.
	KeySize = 32
)

// ErrDecrypt is returned for any malformed, tampered or mis-bound ciphertext.
var ErrDecrypt = errors.New("seal: decryption failed")

// AAD builds the associated data for a ciphertext.
func AAD(purpose, tenant, record string) []byte {
	return []byte("qa/v1/" + purpose + "/" + tenant + "/" + record)
}

// RandomKey returns n cryptographically random bytes.
func RandomKey(n int) ([]byte, error) {
	k := make([]byte, n)
	if _, err := rand.Read(k); err != nil {
		return nil, fmt.Errorf("seal: random: %w", err)
	}
	return k, nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	if len(key) != KeySize {
		return nil, fmt.Errorf("seal: key must be %d bytes, got %d", KeySize, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// Seal encrypts plaintext with key, binding it to aad.
func Seal(key, plaintext, aad []byte) ([]byte, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	out := make([]byte, 1+nonceSize, 1+nonceSize+len(plaintext)+gcm.Overhead())
	out[0] = formatVersion
	if _, err := rand.Read(out[1 : 1+nonceSize]); err != nil {
		return nil, fmt.Errorf("seal: nonce: %w", err)
	}
	return gcm.Seal(out, out[1:1+nonceSize], plaintext, aad), nil
}

// Open decrypts a value produced by Seal (or by the TypeScript implementation).
func Open(key, sealed, aad []byte) ([]byte, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	if len(sealed) < 1+nonceSize+gcm.Overhead() || sealed[0] != formatVersion {
		return nil, ErrDecrypt
	}
	pt, err := gcm.Open(nil, sealed[1:1+nonceSize], sealed[1+nonceSize:], aad)
	if err != nil {
		return nil, ErrDecrypt
	}
	return pt, nil
}

// KEK is a key-encryption key. Data keys are stored only in wrapped form.
// In production the KEK should live in a KMS; this type is the local implementation.
type KEK struct {
	ID  string
	key []byte
}

// ParseKEK decodes a base64 (standard or URL-safe) 32-byte key.
func ParseKEK(id, encoded string) (*KEK, error) {
	if strings.TrimSpace(id) == "" {
		return nil, errors.New("seal: KEK id is empty")
	}
	encoded = strings.TrimSpace(encoded)
	var raw []byte
	var err error
	for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		raw, err = enc.DecodeString(encoded)
		if err == nil {
			break
		}
	}
	if err != nil {
		return nil, fmt.Errorf("seal: KEK %q is not valid base64", id)
	}
	if len(raw) != KeySize {
		return nil, fmt.Errorf("seal: KEK %q must decode to %d bytes, got %d", id, KeySize, len(raw))
	}
	return &KEK{ID: id, key: raw}, nil
}

// Wrap encrypts a data key for a tenant. purpose distinguishes key families ("content", "wastore").
func (k *KEK) Wrap(dek []byte, purpose, tenant string) ([]byte, error) {
	return Seal(k.key, dek, AAD("dek", tenant, purpose))
}

// Unwrap decrypts a data key produced by Wrap.
func (k *KEK) Unwrap(wrapped []byte, purpose, tenant string) ([]byte, error) {
	return Open(k.key, wrapped, AAD("dek", tenant, purpose))
}

// DeriveSubkey derives an independent key from the KEK (HKDF-SHA256), e.g. the sender-hash pepper.
func (k *KEK) DeriveSubkey(info string) ([]byte, error) {
	return hkdf.Key(sha256.New, k.key, []byte("quickassign"), info, KeySize)
}

// SenderHash pseudonymises a WhatsApp sender per tenant, so the same person cannot be
// correlated across tenants and no phone number or LID is stored.
func SenderHash(pepper []byte, tenant, senderID string) string {
	mac := hmac.New(sha256.New, pepper)
	mac.Write([]byte(tenant))
	mac.Write([]byte{'|'})
	mac.Write([]byte(senderID))
	return hex.EncodeToString(mac.Sum(nil))[:32]
}

// Zero overwrites a key buffer. Best effort: Go may have copied it elsewhere.
func Zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

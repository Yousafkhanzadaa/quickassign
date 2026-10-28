package wastore

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func newKey(t *testing.T) []byte {
	t.Helper()
	k := make([]byte, KeySize)
	if _, err := rand.Read(k); err != nil {
		t.Fatal(err)
	}
	return k
}

func newName(t *testing.T) string {
	t.Helper()
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b) + ".db"
}

func TestStoreIsEncryptedAtRest(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	name := newName(t)
	key := newKey(t)

	st, err := Open(ctx, dir, name, key, nil)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	// A fresh device must be creatable (schema upgrade ran).
	dev := st.Container.NewDevice()
	if dev == nil {
		t.Fatal("expected a new device")
	}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("SQLite format 3")) || bytes.Contains(raw, []byte("whatsmeow_device")) {
		t.Fatal("store file is readable without the key")
	}
	info, _ := os.Stat(filepath.Join(dir, name))
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("store file mode = %v, want 0600", info.Mode().Perm())
	}
	if d, _ := os.Stat(dir); d.Mode().Perm() != 0o700 {
		t.Fatalf("store dir mode = %v, want 0700", d.Mode().Perm())
	}

	// Re-open with the right key works; the wrong key does not.
	st2, err := Open(ctx, dir, name, key, nil)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	_ = st2.Close()
	if st3, err := Open(ctx, dir, name, newKey(t), nil); err == nil {
		_ = st3.Close()
		t.Fatal("opening with the wrong key must fail")
	}
}

func TestRejectsUnsafeFileNames(t *testing.T) {
	for _, bad := range []string{"../evil.db", "a.db", "/etc/passwd", "0123456789abcdef0123456789abcdef.db/../x"} {
		if ValidFileName(bad) {
			t.Errorf("%q must be rejected", bad)
		}
		if _, err := Open(context.Background(), t.TempDir(), bad, newKey(t), nil); err == nil {
			t.Errorf("Open(%q) must fail", bad)
		}
	}
}

func TestDestroyRemovesFiles(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	name := newName(t)
	st, err := Open(ctx, dir, name, newKey(t), nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = st.Close()
	if err := Destroy(dir, name); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
		t.Fatal("store file still exists after Destroy")
	}
}

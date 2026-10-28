// Package wastore keeps each tenant's WhatsApp device state (Signal identity keys, sessions,
// pre-keys, app-state keys) in its own SQLite file, encrypted at rest with AES-256-XTS
// under a per-tenant 512-bit data key.
//
// The data key is never written to disk in plaintext: it is wrapped with the gateway KEK and
// stored in Postgres (gateway.sessions). Destroying the wrapped key crypto-shreds the store,
// including any copies that live on in backups.
package wastore

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"

	"github.com/ncruces/go-sqlite3"
	"github.com/ncruces/go-sqlite3/driver"
	_ "github.com/ncruces/go-sqlite3/vfs/xts" // registers the "xts" encrypting VFS

	"go.mau.fi/whatsmeow/store/sqlstore"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// KeySize is the store key length: 64 bytes selects AES-256-XTS.
const KeySize = 64

var fileNamePattern = regexp.MustCompile(`^[0-9a-f]{32}\.db$`)

// ValidFileName reports whether name is a store file name we generated
// (guards against path traversal through a tampered database row).
func ValidFileName(name string) bool {
	return fileNamePattern.MatchString(name)
}

// Store is an open, encrypted whatsmeow container for one tenant.
type Store struct {
	Container *sqlstore.Container
	db        *sql.DB
	path      string
}

// Open opens (creating if needed) the encrypted store at dir/file.
func Open(ctx context.Context, dir, file string, key []byte, log waLog.Logger) (*Store, error) {
	if !ValidFileName(file) {
		return nil, fmt.Errorf("wastore: invalid store file name")
	}
	if len(key) != KeySize {
		return nil, fmt.Errorf("wastore: key must be %d bytes", KeySize)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("wastore: mkdir: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return nil, fmt.Errorf("wastore: chmod dir: %w", err)
	}
	path := filepath.Join(dir, file)
	hexKey := hex.EncodeToString(key)

	// The key is applied with a PRAGMA inside the connection hook rather than as a URI
	// parameter, so it never appears in the DSN or in error messages.
	dsn := "file:" + path + "?vfs=xts&_txlock=immediate"
	db, err := driver.Open(dsn, func(c *sqlite3.Conn) error {
		return c.Exec("PRAGMA hexkey='" + hexKey + "';" +
			"PRAGMA foreign_keys=ON;" +
			"PRAGMA temp_store=MEMORY;" +
			"PRAGMA busy_timeout=15000;" +
			"PRAGMA journal_mode=WAL;" +
			"PRAGMA synchronous=NORMAL;" +
			"PRAGMA secure_delete=ON;")
	})
	if err != nil {
		return nil, fmt.Errorf("wastore: open: %w", err)
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("wastore: unlock failed (wrong key or corrupt file): %w", err)
	}
	container := sqlstore.NewWithDB(db, "sqlite3", log)
	if err := container.Upgrade(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("wastore: upgrade: %w", err)
	}
	if err := os.Chmod(path, 0o600); err != nil && !errors.Is(err, os.ErrNotExist) {
		_ = db.Close()
		return nil, fmt.Errorf("wastore: chmod: %w", err)
	}
	return &Store{Container: container, db: db, path: path}, nil
}

// Close closes the store's database handles.
func (s *Store) Close() error {
	return s.db.Close()
}

// Destroy closes the store and removes its files. Callers must also delete the wrapped
// key (gateway.sessions row); that is what makes the deletion irreversible.
func Destroy(dir, file string) error {
	if !ValidFileName(file) {
		return fmt.Errorf("wastore: invalid store file name")
	}
	base := filepath.Join(dir, file)
	var errs []error
	for _, p := range []string{base, base + "-wal", base + "-shm", base + "-journal"} {
		if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

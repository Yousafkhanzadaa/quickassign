// Package logx configures structured logging and adapts it for whatsmeow.
//
// Rule: logs never contain message content, keys, or phone numbers. whatsmeow log lines
// can include JIDs, so every adapted line is passed through Redact.
package logx

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"strings"

	waLog "go.mau.fi/whatsmeow/util/log"
)

func New(level string) *slog.Logger {
	var lvl slog.Level
	switch strings.ToLower(level) {
	case "debug":
		lvl = slog.LevelDebug
	case "warn":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lvl}))
}

// Long digit runs are phone numbers, LIDs or device IDs.
var digitRun = regexp.MustCompile(`\d{6,}`)

// Redact strips identifiers from free-form log text.
func Redact(s string) string {
	return digitRun.ReplaceAllString(s, "<id>")
}

// TenantTag shortens a tenant id for logs (enough to correlate, not to enumerate).
func TenantTag(tenant string) string {
	if len(tenant) <= 8 {
		return tenant
	}
	return tenant[:8]
}

type waAdapter struct {
	l   *slog.Logger
	min slog.Level
}

// WhatsApp returns a whatsmeow logger that writes redacted lines at or above min.
func WhatsApp(l *slog.Logger, module string, min slog.Level) waLog.Logger {
	return &waAdapter{l: l.With("module", module), min: min}
}

func (a *waAdapter) log(level slog.Level, msg string, args ...any) {
	if level < a.min {
		return
	}
	a.l.Log(context.Background(), level, Redact(fmt.Sprintf(msg, args...)))
}

func (a *waAdapter) Errorf(msg string, args ...any) { a.log(slog.LevelError, msg, args...) }
func (a *waAdapter) Warnf(msg string, args ...any)  { a.log(slog.LevelWarn, msg, args...) }
func (a *waAdapter) Infof(msg string, args ...any)  { a.log(slog.LevelInfo, msg, args...) }
func (a *waAdapter) Debugf(msg string, args ...any) { a.log(slog.LevelDebug, msg, args...) }
func (a *waAdapter) Sub(module string) waLog.Logger {
	return &waAdapter{l: a.l.With("sub", module), min: a.min}
}

// Package config loads and validates gateway configuration from the environment.
// The gateway refuses to start with weak or missing secrets.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/quickassign/gateway/internal/seal"
)

type Config struct {
	Listen        string
	DatabaseURL   string
	StoreDir      string
	InstanceID    string
	DeviceOS      string
	LogLevel      string
	GatewayKEK    *seal.KEK // wraps per-tenant WhatsApp store keys; only the gateway holds it
	AppKEK        *seal.KEK // wraps per-tenant content keys; shared with web/worker
	ServiceSecret map[string][]byte
	MediaMaxBytes int64
	SendPerHour   int
	HistoryDays   int
	HistoryTTL    time.Duration
}

func Load() (*Config, error) {
	var errs []error
	get := func(key, def string) string {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			return v
		}
		return def
	}
	require := func(key string) string {
		v := strings.TrimSpace(os.Getenv(key))
		if v == "" {
			errs = append(errs, fmt.Errorf("%s is required", key))
		}
		return v
	}
	getInt := func(key string, def int) int {
		v := get(key, "")
		if v == "" {
			return def
		}
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			errs = append(errs, fmt.Errorf("%s must be a positive integer", key))
			return def
		}
		return n
	}

	host, _ := os.Hostname()
	c := &Config{
		Listen:        get("GATEWAY_LISTEN", ":8081"),
		DatabaseURL:   require("GATEWAY_DATABASE_URL"),
		StoreDir:      get("GATEWAY_STORE_DIR", "/data/sessions"),
		InstanceID:    get("GATEWAY_INSTANCE_ID", host),
		DeviceOS:      get("GATEWAY_DEVICE_OS", "QuickAssign"),
		LogLevel:      get("LOG_LEVEL", "info"),
		MediaMaxBytes: int64(getInt("GATEWAY_MEDIA_MAX_BYTES", 25<<20)),
		SendPerHour:   getInt("GATEWAY_SEND_PER_HOUR", 40),
		HistoryDays:   getInt("GATEWAY_HISTORY_DAYS", 14),
		HistoryTTL:    time.Duration(getInt("GATEWAY_HISTORY_TTL_MINUTES", 45)) * time.Minute,
		ServiceSecret: map[string][]byte{},
	}

	if k, err := seal.ParseKEK(get("GATEWAY_KEK_ID", "gw-local-v1"), require("GATEWAY_KEK")); err != nil {
		errs = append(errs, err)
	} else {
		c.GatewayKEK = k
	}
	if k, err := seal.ParseKEK(get("APP_KEK_ID", "app-local-v1"), require("APP_KEK")); err != nil {
		errs = append(errs, err)
	} else {
		c.AppKEK = k
	}
	if os.Getenv("GATEWAY_KEK") != "" && os.Getenv("GATEWAY_KEK") == os.Getenv("APP_KEK") {
		errs = append(errs, errors.New("GATEWAY_KEK and APP_KEK must be different keys"))
	}

	for _, svc := range []string{"web", "worker"} {
		key := "GATEWAY_SECRET_" + strings.ToUpper(svc)
		s := require(key)
		if s != "" && len(s) < 32 {
			errs = append(errs, fmt.Errorf("%s must be at least 32 characters", key))
		}
		c.ServiceSecret[svc] = []byte(s)
	}
	if string(c.ServiceSecret["web"]) != "" && string(c.ServiceSecret["web"]) == string(c.ServiceSecret["worker"]) {
		errs = append(errs, errors.New("GATEWAY_SECRET_WEB and GATEWAY_SECRET_WORKER must differ"))
	}
	if c.HistoryDays > 30 {
		errs = append(errs, errors.New("GATEWAY_HISTORY_DAYS must be <= 30"))
	}
	return c, errors.Join(errs...)
}

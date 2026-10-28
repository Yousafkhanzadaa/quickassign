// Command gateway runs the QuickAssign WhatsApp gateway: one linked companion device per
// student, reading only the groups they selected and writing only to their own chat.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.mau.fi/whatsmeow/proto/waCompanionReg"
	"go.mau.fi/whatsmeow/store"
	"google.golang.org/protobuf/proto"

	"github.com/quickassign/gateway/internal/api"
	"github.com/quickassign/gateway/internal/config"
	"github.com/quickassign/gateway/internal/db"
	"github.com/quickassign/gateway/internal/logx"
	"github.com/quickassign/gateway/internal/session"
)

func main() {
	// `gateway healthcheck` lets the distroless container probe itself (no curl in the image).
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}
	// Every file this process creates (session stores and their WAL/SHM sidecars) is
	// readable by its owner only.
	syscall.Umask(0o077)
	cfg, err := config.Load()
	log := logx.New(os.Getenv("LOG_LEVEL"))
	if err != nil {
		log.Error("invalid configuration", "err", err)
		os.Exit(2)
	}

	// How this device appears in the student's Settings > Linked devices, and how much
	// history we ask the phone for (days, not months).
	store.SetOSInfo(cfg.DeviceOS, [3]uint32{1, 0, 0})
	store.DeviceProps.PlatformType = waCompanionReg.DeviceProps_CHROME.Enum()
	store.DeviceProps.RequireFullSync = proto.Bool(false)
	hs := store.DeviceProps.HistorySyncConfig
	hs.RecentSyncDaysLimit = proto.Uint32(uint32(cfg.HistoryDays))
	hs.FullSyncDaysLimit = proto.Uint32(uint32(cfg.HistoryDays))
	hs.InitialSyncMaxMessagesPerChat = proto.Uint32(300)
	hs.StorageQuotaMb = proto.Uint32(512)
	hs.SupportCallLogHistory = proto.Bool(false)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	database, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("database connection failed", "err", err)
		os.Exit(1)
	}
	defer database.Close()

	mgr, err := session.NewManager(cfg, database, log)
	if err != nil {
		log.Error("manager init failed", "err", err)
		os.Exit(1)
	}
	if err := mgr.Start(ctx); err != nil {
		log.Error("manager start failed", "err", err)
		os.Exit(1)
	}

	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           api.New(mgr, database, cfg.ServiceSecret, log).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      90 * time.Second, // SSE extends its own deadline
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	go func() {
		log.Info("gateway listening", "addr", cfg.Listen, "instance", cfg.InstanceID)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("http server failed", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	mgr.Shutdown(shutdownCtx)
}

func healthcheck() int {
	addr := os.Getenv("GATEWAY_LISTEN")
	if addr == "" {
		addr = ":8081"
	}
	if addr[0] == ':' {
		addr = "127.0.0.1" + addr
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://" + addr + "/healthz")
	if err != nil {
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

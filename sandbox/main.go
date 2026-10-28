// Command sandbox renders worked solutions to PDF/DOCX and extracts text from uploaded
// course material. It runs in a container with no network, a read-only root filesystem
// and no secrets: untrusted documents and model output are only ever processed here.
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

type server struct {
	token        []byte
	workDir      string
	templatePath string
	renderSlots  chan struct{}
	extractSlots chan struct{}
	log          *slog.Logger
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	token := os.Getenv("SANDBOX_TOKEN")
	if len(token) < 32 {
		log.Error("SANDBOX_TOKEN must be at least 32 characters")
		os.Exit(2)
	}
	s := &server{
		token:        []byte(token),
		workDir:      envOr("SANDBOX_WORKDIR", "/tmp"),
		templatePath: envOr("SANDBOX_TEMPLATE", "/app/templates/qa.latex"),
		renderSlots:  make(chan struct{}, 2),
		extractSlots: make(chan struct{}, 2),
		log:          log,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /render", s.authed(2<<20, s.renderSlots, func(w http.ResponseWriter, r *http.Request) {
		var req renderRequest
		if !decode(w, r, &req) {
			return
		}
		resp, err := s.render(r.Context(), req)
		respond(w, s.log, resp, err)
	}))
	mux.HandleFunc("POST /extract", s.authed(70<<20, s.extractSlots, func(w http.ResponseWriter, r *http.Request) {
		var req extractRequest
		if !decode(w, r, &req) {
			return
		}
		resp, err := s.extract(r.Context(), req)
		respond(w, s.log, resp, err)
	}))

	srv := &http.Server{
		Addr:              envOr("SANDBOX_LISTEN", ":8090"),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      3 * time.Minute,
		IdleTimeout:       60 * time.Second,
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		log.Info("sandbox listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server failed", "err", err)
			stop()
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdown)
}

// authed checks the bearer token, caps the body, and limits concurrency.
func (s *server) authed(maxBody int64, slots chan struct{}, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(got), s.token) != 1 {
			writeJSON(w, http.StatusUnauthorized, renderError{Code: "unauthorized"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		case <-time.After(30 * time.Second):
			writeJSON(w, http.StatusServiceUnavailable, renderError{Code: "busy"})
			return
		case <-r.Context().Done():
			return
		}
		h(w, r)
	}
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeJSON(w, http.StatusBadRequest, renderError{Code: "invalid_json"})
		return false
	}
	return true
}

func respond(w http.ResponseWriter, log *slog.Logger, resp any, err error) {
	var re *renderError
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, resp)
	case errors.As(err, &re):
		writeJSON(w, http.StatusUnprocessableEntity, re)
	default:
		log.Error("internal error", "err", err)
		writeJSON(w, http.StatusInternalServerError, renderError{Code: "internal"})
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func healthcheck() int {
	addr := envOr("SANDBOX_LISTEN", ":8090")
	if strings.HasPrefix(addr, ":") {
		addr = "127.0.0.1" + addr
	}
	c := &http.Client{Timeout: 3 * time.Second}
	resp, err := c.Get("http://" + addr + "/healthz")
	if err != nil {
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

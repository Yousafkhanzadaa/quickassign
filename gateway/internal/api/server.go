package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/quickassign/gateway/internal/db"
	"github.com/quickassign/gateway/internal/logx"
	"github.com/quickassign/gateway/internal/session"
)

const (
	smallBody    = 64 << 10 // JSON control requests
	documentBody = 30 << 20 // base64 PDF uploads to the student's own chat
)

var tenantPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

type Server struct {
	mgr  *session.Manager
	db   *db.DB
	auth *authenticator
	log  *slog.Logger
}

func New(mgr *session.Manager, database *db.DB, secrets map[string][]byte, log *slog.Logger) *Server {
	return &Server{mgr: mgr, db: database, auth: newAuthenticator(secrets), log: log}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.healthz)

	// Which internal service may call which route.
	route := func(pattern string, maxBody int64, allowed []string, h func(http.ResponseWriter, *http.Request, string)) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			svc, err := s.auth.verify(r, maxBody)
			if errors.Is(err, errTooLarge) {
				writeErr(w, http.StatusRequestEntityTooLarge, "body too large")
				return
			}
			if err != nil {
				writeErr(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			permitted := false
			for _, a := range allowed {
				if a == svc {
					permitted = true
				}
			}
			if !permitted {
				writeErr(w, http.StatusForbidden, "forbidden")
				return
			}
			tenant := r.PathValue("tenant")
			if !tenantPattern.MatchString(tenant) {
				writeErr(w, http.StatusBadRequest, "invalid tenant")
				return
			}
			h(w, r, tenant)
		})
	}
	web, worker, both := []string{"web"}, []string{"worker"}, []string{"web", "worker"}

	route("POST /v1/tenants/{tenant}/link", smallBody, web, s.startLink)
	route("GET /v1/tenants/{tenant}/link/events", 0, web, s.linkEvents)
	route("GET /v1/tenants/{tenant}/status", 0, both, s.status)
	route("POST /v1/tenants/{tenant}/groups/refresh", smallBody, web, s.refreshGroups)
	route("POST /v1/tenants/{tenant}/monitored/reload", smallBody, web, s.reloadMonitored)
	route("DELETE /v1/tenants/{tenant}", smallBody, web, s.unlink)
	route("POST /v1/tenants/{tenant}/self/text", smallBody, worker, s.sendText)
	route("POST /v1/tenants/{tenant}/self/document", documentBody, worker, s.sendDocument)
	route("POST /v1/tenants/{tenant}/media/fetch", smallBody, worker, s.fetchMedia)

	return securityHeaders(mux)
}

func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.db.Ping(ctx); err != nil {
		writeErr(w, http.StatusServiceUnavailable, "db unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) startLink(w http.ResponseWriter, r *http.Request, tenant string) {
	var req struct {
		Method string `json:"method"`
		Phone  string `json:"phone"`
	}
	if !decode(w, r, &req) {
		return
	}
	_, err := s.mgr.StartPairing(r.Context(), tenant, req.Method, strings.TrimPrefix(strings.TrimSpace(req.Phone), "+"))
	switch {
	case errors.Is(err, session.ErrAlreadyLinked):
		writeErr(w, http.StatusConflict, "already_linked")
	case errors.Is(err, session.ErrBadPhone):
		writeErr(w, http.StatusBadRequest, "bad_phone")
	case err != nil:
		s.log.Error("start pairing failed", "tenant", logx.TenantTag(tenant), "err", logx.Redact(err.Error()))
		writeErr(w, http.StatusInternalServerError, "pairing_failed")
	default:
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "pairing"})
	}
}

// linkEvents streams pairing progress (QR codes / pairing code / result) as Server-Sent Events.
func (s *Server) linkEvents(w http.ResponseWriter, r *http.Request, tenant string) {
	p := s.mgr.Pairing(tenant)
	if p == nil {
		writeErr(w, http.StatusNotFound, "no_pairing")
		return
	}
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Now().Add(5 * time.Minute))
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	replay, ch, cancel := p.Subscribe()
	defer cancel()
	send := func(e session.PairEvent) bool {
		b, _ := json.Marshal(e)
		if _, err := fmt.Fprintf(w, "data: %s\n\n", b); err != nil {
			return false
		}
		return rc.Flush() == nil
	}
	for _, e := range replay {
		if !send(e) {
			return
		}
	}
	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case e, ok := <-ch:
			if !ok || !send(e) {
				return
			}
		case <-keepalive.C:
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil || rc.Flush() != nil {
				return
			}
		}
	}
}

func (s *Server) status(w http.ResponseWriter, _ *http.Request, tenant string) {
	writeJSON(w, http.StatusOK, s.mgr.Status(tenant))
}

func (s *Server) refreshGroups(w http.ResponseWriter, r *http.Request, tenant string) {
	sess := s.mgr.Get(tenant)
	if sess == nil {
		writeErr(w, http.StatusConflict, "not_linked")
		return
	}
	n, err := sess.RefreshGroups(r.Context())
	if err != nil {
		s.respondSessionErr(w, tenant, "group refresh", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"groups": n})
}

func (s *Server) reloadMonitored(w http.ResponseWriter, r *http.Request, tenant string) {
	sess := s.mgr.Get(tenant)
	if sess == nil {
		writeErr(w, http.StatusConflict, "not_linked")
		return
	}
	if err := sess.ReloadMonitored(r.Context()); err != nil {
		s.respondSessionErr(w, tenant, "monitored reload", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) unlink(w http.ResponseWriter, r *http.Request, tenant string) {
	if err := s.mgr.Unlink(r.Context(), tenant); err != nil {
		s.log.Error("unlink failed", "tenant", logx.TenantTag(tenant), "err", err)
		writeErr(w, http.StatusInternalServerError, "unlink_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "unlinked"})
}

func (s *Server) sendText(w http.ResponseWriter, r *http.Request, tenant string) {
	var req struct {
		Text string `json:"text"`
	}
	if !decode(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Text) == "" || utf8.RuneCountInString(req.Text) > 4000 {
		writeErr(w, http.StatusBadRequest, "invalid_text")
		return
	}
	sess := s.mgr.Get(tenant)
	if sess == nil {
		writeErr(w, http.StatusConflict, "not_linked")
		return
	}
	id, err := sess.SendSelfText(r.Context(), req.Text)
	if err != nil {
		s.respondSessionErr(w, tenant, "send text", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"wa_message_id": id})
}

var safeFileName = regexp.MustCompile(`^[\p{L}\p{N} ._()\-]{1,120}\.(pdf|docx)$`)

func (s *Server) sendDocument(w http.ResponseWriter, r *http.Request, tenant string) {
	var req struct {
		FileName string `json:"file_name"`
		Mime     string `json:"mime"`
		Caption  string `json:"caption"`
		Data     string `json:"data_b64"`
	}
	if !decode(w, r, &req) {
		return
	}
	if !safeFileName.MatchString(req.FileName) ||
		(req.Mime != "application/pdf" && req.Mime != "application/vnd.openxmlformats-officedocument.wordprocessingml.document") ||
		utf8.RuneCountInString(req.Caption) > 1000 {
		writeErr(w, http.StatusBadRequest, "invalid_document")
		return
	}
	data, err := base64.StdEncoding.DecodeString(req.Data)
	if err != nil || len(data) == 0 {
		writeErr(w, http.StatusBadRequest, "invalid_document")
		return
	}
	sess := s.mgr.Get(tenant)
	if sess == nil {
		writeErr(w, http.StatusConflict, "not_linked")
		return
	}
	id, err := sess.SendSelfDocument(r.Context(), req.FileName, req.Mime, req.Caption, data)
	if err != nil {
		s.respondSessionErr(w, tenant, "send document", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"wa_message_id": id})
}

func (s *Server) fetchMedia(w http.ResponseWriter, r *http.Request, tenant string) {
	var req struct {
		MessageID string `json:"message_id"`
	}
	if !decode(w, r, &req) {
		return
	}
	id, err := uuid.Parse(req.MessageID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_message_id")
		return
	}
	sess := s.mgr.Get(tenant)
	if sess == nil {
		writeErr(w, http.StatusConflict, "not_linked")
		return
	}
	data, mime, err := sess.FetchMedia(r.Context(), id)
	switch {
	case errors.Is(err, db.ErrNotFound), errors.Is(err, session.ErrNoMedia):
		writeErr(w, http.StatusNotFound, "no_media")
		return
	case errors.Is(err, session.ErrTooLarge):
		writeErr(w, http.StatusRequestEntityTooLarge, "media_too_large")
		return
	case err != nil:
		s.respondSessionErr(w, tenant, "fetch media", err)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("X-QA-Media-Mime", mime)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *Server) respondSessionErr(w http.ResponseWriter, tenant, op string, err error) {
	switch {
	case errors.Is(err, session.ErrNotRunning), errors.Is(err, session.ErrNotLoggedIn):
		writeErr(w, http.StatusConflict, "not_connected")
	case errors.Is(err, session.ErrRateLimited):
		writeErr(w, http.StatusTooManyRequests, "rate_limited")
	case errors.Is(err, session.ErrRecipientNotAllowed):
		s.log.Error("BLOCKED send to non-owner recipient", "tenant", logx.TenantTag(tenant))
		writeErr(w, http.StatusForbidden, "recipient_not_allowed")
	default:
		s.log.Error(op+" failed", "tenant", logx.TenantTag(tenant), "err", logx.Redact(err.Error()))
		writeErr(w, http.StatusBadGateway, "whatsapp_error")
	}
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

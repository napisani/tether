package gateway

import (
	"context"
	"encoding/json"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

type Snapshot struct {
	DaemonConnected bool                       `json:"daemon_connected"`
	Events          map[string]json.RawMessage `json:"events"`
}

type Bus interface {
	Send(context.Context, json.RawMessage) error
	Subscribe() (<-chan json.RawMessage, func())
	Snapshot() Snapshot
	Ready() bool
}

type Config struct {
	AllowedHosts []string
}

func NewHandler(bus Bus, assets fs.FS, config Config) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		if !bus.Ready() {
			http.Error(w, "tetherd is unavailable", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte("ready\n"))
	})
	mux.HandleFunc("GET /api/v1/state", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(bus.Snapshot())
	})
	mux.HandleFunc("GET /api/v1/events", func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming is unavailable", http.StatusInternalServerError)
			return
		}
		events, unsubscribe := bus.Subscribe()
		defer unsubscribe()

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		flusher.Flush()

		heartbeat := time.NewTicker(15 * time.Second)
		defer heartbeat.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case <-heartbeat.C:
				if _, err := w.Write([]byte(": keepalive\n\n")); err != nil {
					return
				}
				flusher.Flush()
			case event, open := <-events:
				if !open {
					return
				}
				if _, err := w.Write([]byte("data: " + string(event) + "\n\n")); err != nil {
					return
				}
				flusher.Flush()
			}
		}
	})

	mux.HandleFunc("POST /api/v1/commands", func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
			http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
			return
		}

		var command json.RawMessage
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
		if err := decoder.Decode(&command); err != nil {
			http.Error(w, "invalid JSON command", http.StatusBadRequest)
			return
		}
		var trailing json.RawMessage
		if err := decoder.Decode(&trailing); err != io.EOF {
			http.Error(w, "request must contain one JSON command", http.StatusBadRequest)
			return
		}
		var envelope struct {
			Command string `json:"command"`
		}
		if err := json.Unmarshal(command, &envelope); err != nil || envelope.Command == "" {
			http.Error(w, "command is required", http.StatusBadRequest)
			return
		}
		if err := bus.Send(r.Context(), command); err != nil {
			http.Error(w, "tetherd is unavailable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})

	if assets != nil {
		mux.Handle("/", http.FileServer(http.FS(assets)))
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'")
		w.Header().Set("Permissions-Policy", "camera=(), geolocation=(), microphone=()")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		if len(config.AllowedHosts) > 0 && !slices.Contains(config.AllowedHosts, hostname(r.Host)) {
			http.Error(w, "unrecognized host", http.StatusMisdirectedRequest)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				http.Error(w, "cross-site request rejected", http.StatusForbidden)
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" && !sameOrigin(origin, r.Host) {
				http.Error(w, "cross-origin request rejected", http.StatusForbidden)
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}

func hostname(hostport string) string {
	if host, _, err := net.SplitHostPort(hostport); err == nil {
		return strings.Trim(host, "[]")
	}
	return strings.Trim(hostport, "[]")
}

func sameOrigin(origin, requestHost string) bool {
	parsed, err := url.Parse(origin)
	return err == nil && parsed.Host == requestHost
}

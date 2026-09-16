package gateway_test

import (
	"bufio"
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"testing/fstest"

	"github.com/napisani/tether/web/internal/gateway"
)

type fakeBus struct {
	mu          sync.Mutex
	commands    []json.RawMessage
	ready       bool
	snapshot    gateway.Snapshot
	subscribers map[chan json.RawMessage]struct{}
}

func (b *fakeBus) Send(_ context.Context, command json.RawMessage) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.commands = append(b.commands, append(json.RawMessage(nil), command...))
	return nil
}

func (b *fakeBus) Subscribe() (<-chan json.RawMessage, func()) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.subscribers == nil {
		b.subscribers = make(map[chan json.RawMessage]struct{})
	}
	ch := make(chan json.RawMessage, 1)
	b.subscribers[ch] = struct{}{}
	return ch, func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		delete(b.subscribers, ch)
		close(ch)
	}
}

func (b *fakeBus) publish(event json.RawMessage) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for subscriber := range b.subscribers {
		subscriber <- append(json.RawMessage(nil), event...)
	}
}

func (b *fakeBus) Snapshot() gateway.Snapshot { return b.snapshot }
func (b *fakeBus) Ready() bool                { return b.ready }

func testAssets() fs.FS {
	return fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<main>Tether</main>")}}
}

func TestCommandEndpointRejectsUntrustedBrowserRequests(t *testing.T) {
	for _, test := range []struct {
		name       string
		host       string
		origin     string
		fetchSite  string
		wantStatus int
	}{
		{name: "unknown host", host: "attacker.test", wantStatus: http.StatusMisdirectedRequest},
		{name: "cross origin", host: "tether.test", origin: "https://attacker.test", wantStatus: http.StatusForbidden},
		{name: "cross site", host: "tether.test", fetchSite: "cross-site", wantStatus: http.StatusForbidden},
		{name: "same origin", host: "tether.test", origin: "https://tether.test", fetchSite: "same-origin", wantStatus: http.StatusAccepted},
	} {
		t.Run(test.name, func(t *testing.T) {
			bus := &fakeBus{ready: true}
			handler := gateway.NewHandler(bus, testAssets(), gateway.Config{AllowedHosts: []string{"tether.test"}})
			req := httptest.NewRequest(http.MethodPost, "http://"+test.host+"/api/v1/commands", strings.NewReader(`{"command":"bt_scan"}`))
			req.Header.Set("Content-Type", "application/json")
			if test.origin != "" {
				req.Header.Set("Origin", test.origin)
			}
			if test.fetchSite != "" {
				req.Header.Set("Sec-Fetch-Site", test.fetchSite)
			}
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, req)

			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, test.wantStatus, response.Body.String())
			}
		})
	}
}

func TestStateAndReadinessExposeDaemonConnection(t *testing.T) {
	bus := &fakeBus{
		ready: true,
		snapshot: gateway.Snapshot{
			DaemonConnected: true,
			Events: map[string]json.RawMessage{
				"bt_status": json.RawMessage(`{"command":"bt_status","available":true}`),
			},
		},
	}
	handler := gateway.NewHandler(bus, testAssets(), gateway.Config{})

	stateRequest := httptest.NewRequest(http.MethodGet, "http://tether.test/api/v1/state", nil)
	stateResponse := httptest.NewRecorder()
	handler.ServeHTTP(stateResponse, stateRequest)
	if stateResponse.Code != http.StatusOK {
		t.Fatalf("state status = %d; body = %s", stateResponse.Code, stateResponse.Body.String())
	}
	if stateResponse.Header().Get("Content-Security-Policy") == "" || stateResponse.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatalf("security headers = %#v", stateResponse.Header())
	}
	if got := stateResponse.Body.String(); got != "{\"daemon_connected\":true,\"events\":{\"bt_status\":{\"command\":\"bt_status\",\"available\":true}}}\n" {
		t.Fatalf("state = %s", got)
	}

	readyRequest := httptest.NewRequest(http.MethodGet, "http://tether.test/readyz", nil)
	readyResponse := httptest.NewRecorder()
	handler.ServeHTTP(readyResponse, readyRequest)
	if readyResponse.Code != http.StatusOK {
		t.Fatalf("ready status = %d; body = %s", readyResponse.Code, readyResponse.Body.String())
	}
}

func TestEventEndpointStreamsDaemonEvents(t *testing.T) {
	bus := &fakeBus{ready: true}
	handler := gateway.NewHandler(bus, testAssets(), gateway.Config{})
	server := httptest.NewServer(handler)
	defer server.Close()

	response, err := server.Client().Get(server.URL + "/api/v1/events")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusOK)
	}

	bus.publish(json.RawMessage(`{"command":"bt_pair_progress","step":"pair","detail":"Waiting for confirmation"}`))
	reader := bufio.NewReader(response.Body)
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if line != "data: {\"command\":\"bt_pair_progress\",\"step\":\"pair\",\"detail\":\"Waiting for confirmation\"}\n" {
		t.Fatalf("event line = %q", line)
	}
}

func TestCommandEndpointRejectsTrailingJson(t *testing.T) {
	bus := &fakeBus{ready: true}
	handler := gateway.NewHandler(bus, testAssets(), gateway.Config{})
	req := httptest.NewRequest(http.MethodPost, "http://tether.test/api/v1/commands", strings.NewReader(`{"command":"bt_scan"} {"command":"bt_unpair"}`))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, req)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	if len(bus.commands) != 0 {
		t.Fatalf("forwarded commands = %q, want none", bus.commands)
	}
}

func TestCommandEndpointForwardsDaemonCommand(t *testing.T) {
	bus := &fakeBus{ready: true}
	handler := gateway.NewHandler(bus, testAssets(), gateway.Config{AllowedHosts: []string{"tether.test"}})
	req := httptest.NewRequest(http.MethodPost, "http://tether.test/api/v1/commands", strings.NewReader(`{"command":"bt_scan"}`))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, req)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusAccepted, response.Body.String())
	}
	if len(bus.commands) != 1 || string(bus.commands[0]) != `{"command":"bt_scan"}` {
		t.Fatalf("forwarded commands = %q", bus.commands)
	}
}

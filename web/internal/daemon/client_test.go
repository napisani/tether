package daemon_test

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"testing"
	"time"

	"github.com/napisani/tether/web/internal/daemon"
)

func TestClientBridgesUnixCommandsAndEvents(t *testing.T) {
	socketPath := fmt.Sprintf("/tmp/tether-web-%d.sock", os.Getpid())
	_ = os.Remove(socketPath)
	defer os.Remove(socketPath)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	client := daemon.New(socketPath, 10*time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go client.Run(ctx)

	connection, err := listener.Accept()
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	reader := bufio.NewReader(connection)

	for _, want := range []string{
		`{"command":"subscribe"}` + "\n",
		`{"command":"bt_status"}` + "\n",
		`{"command":"bt_list_devices"}` + "\n",
		`{"command":"bt_connection"}` + "\n",
	} {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if line != want {
			t.Fatalf("bootstrap command = %q, want %q", line, want)
		}
	}

	events, unsubscribe := client.Subscribe()
	defer unsubscribe()
	if _, err := connection.Write([]byte(`{"command":"bt_status","available":true}` + "\n")); err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-events:
		if string(event) != `{"command":"bt_status","available":true}` {
			t.Fatalf("event = %s", event)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for daemon event")
	}

	snapshot := client.Snapshot()
	if !snapshot.DaemonConnected || string(snapshot.Events["bt_status"]) != `{"command":"bt_status","available":true}` {
		t.Fatalf("snapshot = %#v", snapshot)
	}

	command := json.RawMessage(`{"command":"bt_scan"}`)
	if err := client.Send(context.Background(), command); err != nil {
		t.Fatal(err)
	}
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if line != string(command)+"\n" {
		t.Fatalf("forwarded command = %q", line)
	}
}

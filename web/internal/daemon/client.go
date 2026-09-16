package daemon

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"sync"
	"time"

	"github.com/napisani/tether/web/internal/gateway"
)

var ErrUnavailable = errors.New("tetherd is unavailable")

var durableEvents = map[string]struct{}{
	"gateway_status":        {},
	"protocol_info":         {},
	"state_snapshot":        {},
	"bt_status":             {},
	"bt_devices":            {},
	"bt_connection_changed": {},
}

type Client struct {
	socketPath    string
	retryInterval time.Duration
	connectionMu  sync.RWMutex
	connection    net.Conn
	writeMu       sync.Mutex
	stateMu       sync.RWMutex
	events        map[string]json.RawMessage
	subscribers   map[chan json.RawMessage]struct{}
}

func New(socketPath string, retryInterval time.Duration) *Client {
	return &Client{
		socketPath:    socketPath,
		retryInterval: retryInterval,
		events:        make(map[string]json.RawMessage),
		subscribers:   make(map[chan json.RawMessage]struct{}),
	}
}

func (c *Client) Run(ctx context.Context) {
	for ctx.Err() == nil {
		connection, err := (&net.Dialer{}).DialContext(ctx, "unix", c.socketPath)
		if err != nil {
			if !wait(ctx, c.retryInterval) {
				return
			}
			continue
		}

		stopClose := context.AfterFunc(ctx, func() { _ = connection.Close() })
		c.setConnection(connection)
		c.publish(json.RawMessage(`{"command":"gateway_status","daemon_connected":true}`))
		for _, command := range []json.RawMessage{
			json.RawMessage(`{"command":"subscribe"}`),
			json.RawMessage(`{"command":"bt_status"}`),
			json.RawMessage(`{"command":"bt_list_devices"}`),
			json.RawMessage(`{"command":"bt_connection"}`),
		} {
			if err := c.Send(ctx, command); err != nil {
				break
			}
		}

		scanner := bufio.NewScanner(connection)
		scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
		for scanner.Scan() {
			line := append(json.RawMessage(nil), scanner.Bytes()...)
			if json.Valid(line) {
				c.publish(line)
			}
		}
		stopClose()
		c.clearConnection(connection)
		c.publish(json.RawMessage(`{"command":"gateway_status","daemon_connected":false}`))
		_ = connection.Close()
	}
}

func (c *Client) Send(ctx context.Context, command json.RawMessage) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	c.connectionMu.RLock()
	connection := c.connection
	c.connectionMu.RUnlock()
	if connection == nil {
		return ErrUnavailable
	}

	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	deadline := time.Now().Add(5 * time.Second)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	_ = connection.SetWriteDeadline(deadline)
	defer connection.SetWriteDeadline(time.Time{})
	payload := make([]byte, 0, len(command)+1)
	payload = append(payload, command...)
	payload = append(payload, '\n')
	_, err := connection.Write(payload)
	return err
}

func (c *Client) Subscribe() (<-chan json.RawMessage, func()) {
	channel := make(chan json.RawMessage, 32)
	c.stateMu.Lock()
	c.subscribers[channel] = struct{}{}
	c.stateMu.Unlock()

	var once sync.Once
	return channel, func() {
		once.Do(func() {
			c.stateMu.Lock()
			defer c.stateMu.Unlock()
			if _, exists := c.subscribers[channel]; exists {
				delete(c.subscribers, channel)
				close(channel)
			}
		})
	}
}

func (c *Client) Snapshot() gateway.Snapshot {
	c.stateMu.RLock()
	defer c.stateMu.RUnlock()
	events := make(map[string]json.RawMessage, len(c.events))
	for command, event := range c.events {
		events[command] = append(json.RawMessage(nil), event...)
	}
	return gateway.Snapshot{DaemonConnected: c.Ready(), Events: events}
}

func (c *Client) Ready() bool {
	c.connectionMu.RLock()
	defer c.connectionMu.RUnlock()
	return c.connection != nil
}

func (c *Client) publish(event json.RawMessage) {
	var envelope struct {
		Command string `json:"command"`
	}
	if err := json.Unmarshal(event, &envelope); err != nil || envelope.Command == "" {
		return
	}

	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	if _, durable := durableEvents[envelope.Command]; durable {
		c.events[envelope.Command] = append(json.RawMessage(nil), event...)
	}
	for subscriber := range c.subscribers {
		select {
		case subscriber <- append(json.RawMessage(nil), event...):
		default:
			delete(c.subscribers, subscriber)
			close(subscriber)
		}
	}
}

func (c *Client) setConnection(connection net.Conn) {
	c.connectionMu.Lock()
	defer c.connectionMu.Unlock()
	c.connection = connection
}

func (c *Client) clearConnection(connection net.Conn) {
	c.connectionMu.Lock()
	defer c.connectionMu.Unlock()
	if c.connection == connection {
		c.connection = nil
	}
}

func wait(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

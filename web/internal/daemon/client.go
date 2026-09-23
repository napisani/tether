package daemon

import (
	"encoding/json"
	"errors"
	"net"
	"sync"
	"time"

	"github.com/napisani/tether/web/internal/gateway"
)

var (
	ErrUnavailable     = errors.New("tetherd is unavailable")
	ErrSubscriberLimit = errors.New("event subscriber limit reached")
)

type Client struct {
	socketPath    string
	retryInterval time.Duration
	connectionMu  sync.RWMutex
	connection    net.Conn
	writeMu       sync.Mutex
	stateMu       sync.RWMutex
	events        map[string]json.RawMessage
	history       []gateway.Event
	historyBytes  int
	nextEventID   uint64
	subscribers   map[chan gateway.Event]struct{}
}

func New(socketPath string, retryInterval time.Duration) *Client {
	if retryInterval <= 0 {
		retryInterval = time.Second
	}
	if retryInterval > maxRetryDelay {
		retryInterval = maxRetryDelay
	}
	return &Client{
		socketPath:    socketPath,
		retryInterval: retryInterval,
		events:        make(map[string]json.RawMessage),
		history:       make([]gateway.Event, 0, maxReplayEvents),
		subscribers:   make(map[chan gateway.Event]struct{}),
	}
}

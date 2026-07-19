package server

import (
	"fmt"
	stdhttp "net/http"
	"strconv"
	"strings"
	"time"

	v1 "astraflow-api/api/astraflow/v1"
	"astraflow-api/internal/service"

	kerrors "github.com/go-kratos/kratos/v3/errors"
	"google.golang.org/protobuf/encoding/protojson"
)

const (
	syncStreamPollInterval = 750 * time.Millisecond
	syncStreamHeartbeat    = 5 * time.Second
	// The default HTTP request timeout is 15 seconds. The short-lived stream is
	// intentionally renewed by the mobile client with the last durable cursor.
	syncStreamLifetime = 12 * time.Second
)

type SyncStreamHandler struct {
	service *service.CrossDeviceService
}

func NewSyncStreamHandler(crossDevice *service.CrossDeviceService) *SyncStreamHandler {
	return &SyncStreamHandler{service: crossDevice}
}

func (handler *SyncStreamHandler) ServeHTTP(response stdhttp.ResponseWriter, request *stdhttp.Request) {
	if request.Method != stdhttp.MethodGet {
		response.Header().Set("Allow", stdhttp.MethodGet)
		stdhttp.Error(response, "method not allowed", stdhttp.StatusMethodNotAllowed)
		return
	}
	flusher, ok := response.(stdhttp.Flusher)
	if !ok {
		stdhttp.Error(response, "streaming is unavailable", stdhttp.StatusInternalServerError)
		return
	}

	after := syncStreamCursor(request)
	authorization := request.Header.Get("Authorization")
	batch, err := handler.service.PullSyncEventsAuthorized(request.Context(), authorization, after, 100)
	if err != nil {
		writeStreamError(response, err)
		return
	}

	response.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	response.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	response.Header().Set("Connection", "keep-alive")
	response.Header().Set("X-Accel-Buffering", "no")
	response.WriteHeader(stdhttp.StatusOK)

	writeBatch := func(value *v1.PullSyncEventsResponse) bool {
		if value.GetResyncRequired() {
			if _, err := fmt.Fprintf(response, "event: resync_required\ndata: {\"resyncRequired\":true}\n\n"); err != nil {
				return false
			}
			flusher.Flush()
			return false
		}
		for _, event := range value.GetEvents() {
			payload, err := protojson.Marshal(event)
			if err != nil {
				return false
			}
			if _, err := fmt.Fprintf(response, "id: %d\nevent: sync\ndata: %s\n\n", event.GetCursor(), payload); err != nil {
				return false
			}
			after = event.GetCursor()
		}
		flusher.Flush()
		return true
	}

	if !writeBatch(batch) {
		return
	}
	poll := time.NewTicker(syncStreamPollInterval)
	heartbeat := time.NewTicker(syncStreamHeartbeat)
	lifetime := time.NewTimer(syncStreamLifetime)
	defer poll.Stop()
	defer heartbeat.Stop()
	defer lifetime.Stop()

	for {
		select {
		case <-request.Context().Done():
			return
		case <-lifetime.C:
			_, _ = fmt.Fprintf(response, "event: reconnect\ndata: {\"after\":%d}\n\n", after)
			flusher.Flush()
			return
		case <-heartbeat.C:
			if _, err := fmt.Fprintf(response, ": heartbeat %d\n\n", time.Now().Unix()); err != nil {
				return
			}
			flusher.Flush()
		case <-poll.C:
			for {
				batch, err = handler.service.PullSyncEventsAuthorized(request.Context(), authorization, after, 100)
				if err != nil || !writeBatch(batch) {
					return
				}
				if !batch.GetHasMore() {
					break
				}
			}
		}
	}
}

func syncStreamCursor(request *stdhttp.Request) int64 {
	value := strings.TrimSpace(request.URL.Query().Get("after"))
	if value == "" {
		value = strings.TrimSpace(request.Header.Get("Last-Event-ID"))
	}
	cursor, err := strconv.ParseInt(value, 10, 64)
	if err != nil || cursor < 0 {
		return 0
	}
	return cursor
}

func writeStreamError(response stdhttp.ResponseWriter, err error) {
	status := int(kerrors.FromError(err).Code)
	if status < 400 || status > 599 {
		status = stdhttp.StatusInternalServerError
	}
	stdhttp.Error(response, stdhttp.StatusText(status), status)
}

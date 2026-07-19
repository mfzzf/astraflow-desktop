package server

import (
	"net/http/httptest"
	"testing"
)

func TestSyncStreamCursorPrefersQueryAndAcceptsLastEventID(t *testing.T) {
	tests := []struct {
		url      string
		header   string
		expected int64
	}{
		{url: "/v1/sync/stream?after=42", header: "9", expected: 42},
		{url: "/v1/sync/stream", header: "9", expected: 9},
		{url: "/v1/sync/stream?after=-1", expected: 0},
		{url: "/v1/sync/stream?after=invalid", expected: 0},
	}
	for _, test := range tests {
		request := httptest.NewRequest("GET", test.url, nil)
		request.Header.Set("Last-Event-ID", test.header)
		if got := syncStreamCursor(request); got != test.expected {
			t.Fatalf("syncStreamCursor(%q) = %d, want %d", test.url, got, test.expected)
		}
	}
}

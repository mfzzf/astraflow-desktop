package server

import (
	"strings"
	"testing"

	v1 "astraflow-api/api/astraflow/v1"
)

func TestOpenAPIJSONCodecUsesProtobufJSONFieldNames(t *testing.T) {
	codec := openAPIJSONCodec{}
	request := &v1.CreateFeedbackRequest{}

	if err := codec.Unmarshal([]byte(`{"sessionId":"session-1","messagesJson":"[]"}`), request); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	if request.GetSessionId() != "session-1" || request.GetMessagesJson() != "[]" {
		t.Fatalf("Unmarshal() request = %#v", request)
	}

	data, err := codec.Marshal(&v1.CreateFeedbackResponse{FeedbackId: "feedback-1"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	jsonBody := string(data)
	if !strings.Contains(jsonBody, `"feedbackId":"feedback-1"`) {
		t.Fatalf("Marshal() body = %s", jsonBody)
	}
	if strings.Contains(jsonBody, "feedback_id") {
		t.Fatalf("Marshal() used Go struct JSON field name: %s", jsonBody)
	}
}

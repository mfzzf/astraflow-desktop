package biz

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type feedbackRepoStub struct {
	created *Feedback
	err     error
}

func (repo *feedbackRepoStub) CreateFeedback(_ context.Context, feedback *Feedback) error {
	repo.created = feedback
	return repo.err
}

type oauthVerifierStub struct {
	err error
}

func (verifier oauthVerifierStub) Verify(context.Context, string) error {
	return verifier.err
}

func validFeedback() *Feedback {
	return &Feedback{
		SessionID:     "session-1",
		EntryPoint:    FeedbackEntryPointTitlebar,
		Description:   "The response disappeared.",
		MessagesJSON:  `[{"id":"message-1"}]`,
		ReporterEmail: "user@example.com",
	}
}

func TestCreateFeedback(t *testing.T) {
	repo := &feedbackRepoStub{}
	uc := NewFeedbackUsecase(repo, oauthVerifierStub{})

	feedback, err := uc.CreateFeedback(context.Background(), "Bearer token", validFeedback())
	if err != nil {
		t.Fatalf("CreateFeedback() error = %v", err)
	}
	if repo.created != feedback {
		t.Fatal("CreateFeedback() did not persist the normalized feedback")
	}
}

func TestCreateFeedbackWithoutSession(t *testing.T) {
	repo := &feedbackRepoStub{}
	uc := NewFeedbackUsecase(repo, oauthVerifierStub{})
	feedback := validFeedback()
	feedback.SessionID = ""
	feedback.MessagesJSON = ""

	if _, err := uc.CreateFeedback(context.Background(), "Bearer token", feedback); err != nil {
		t.Fatalf("CreateFeedback() error = %v", err)
	}
	if repo.created != feedback {
		t.Fatal("CreateFeedback() did not persist sessionless feedback")
	}
}

func TestCreateFeedbackWithEmptySessionMessages(t *testing.T) {
	repo := &feedbackRepoStub{}
	uc := NewFeedbackUsecase(repo, oauthVerifierStub{})
	feedback := validFeedback()
	feedback.MessagesJSON = "[]"

	if _, err := uc.CreateFeedback(context.Background(), "Bearer token", feedback); err != nil {
		t.Fatalf("CreateFeedback() error = %v", err)
	}
}

func TestCreateFeedbackRejectsOAuthFailure(t *testing.T) {
	expected := errors.New("invalid token")
	uc := NewFeedbackUsecase(&feedbackRepoStub{}, oauthVerifierStub{err: expected})

	_, err := uc.CreateFeedback(context.Background(), "Bearer token", validFeedback())
	if !errors.Is(err, expected) {
		t.Fatalf("CreateFeedback() error = %v, want %v", err, expected)
	}
}

func TestCreateFeedbackValidation(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Feedback)
	}{
		{name: "missing description", mutate: func(feedback *Feedback) { feedback.Description = " " }},
		{name: "invalid messages", mutate: func(feedback *Feedback) { feedback.MessagesJSON = "{" }},
		{name: "null messages", mutate: func(feedback *Feedback) { feedback.MessagesJSON = "null" }},
		{name: "messages without session", mutate: func(feedback *Feedback) { feedback.SessionID = "" }},
		{name: "message target without session", mutate: func(feedback *Feedback) {
			feedback.SessionID = ""
			feedback.MessagesJSON = ""
			feedback.EntryPoint = FeedbackEntryPointMessageAction
			feedback.TargetMessageID = "message-1"
		}},
		{name: "message target required", mutate: func(feedback *Feedback) { feedback.EntryPoint = FeedbackEntryPointMessageAction }},
		{name: "too many images", mutate: func(feedback *Feedback) {
			feedback.Images = []*FeedbackImage{{}, {}, {}, {}}
		}},
		{name: "unsupported image", mutate: func(feedback *Feedback) {
			feedback.Images = []*FeedbackImage{{Name: "bug.bmp", MimeType: "image/bmp", Content: []byte("x")}}
		}},
		{name: "oversized image", mutate: func(feedback *Feedback) {
			feedback.Images = []*FeedbackImage{{Name: "bug.png", MimeType: "image/png", Content: make([]byte, MaxFeedbackImageBytes+1)}}
		}},
		{name: "description too long", mutate: func(feedback *Feedback) {
			feedback.Description = strings.Repeat("a", MaxFeedbackDescriptionRunes+1)
		}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			feedback := validFeedback()
			test.mutate(feedback)
			uc := NewFeedbackUsecase(&feedbackRepoStub{}, oauthVerifierStub{})

			if _, err := uc.CreateFeedback(context.Background(), "Bearer token", feedback); err == nil {
				t.Fatal("CreateFeedback() error = nil, want validation error")
			}
		})
	}
}

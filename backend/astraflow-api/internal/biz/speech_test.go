package biz

import (
	"context"
	"testing"
)

type speechRepoStub struct {
	transcript *Transcript
	title      *SpeechTitle
}

func (s speechRepoStub) Transcribe(context.Context, SpeechSource) (*Transcript, error) {
	return s.transcript, nil
}

func (s speechRepoStub) GenerateTitle(context.Context, string, string, uint32) (*SpeechTitle, error) {
	return s.title, nil
}

func TestSpeechUsecaseProcess(t *testing.T) {
	uc := NewSpeechUsecase(speechRepoStub{
		transcript: &Transcript{Text: "讨论了单卡部署语音识别模型", DetectedLanguage: "zh"},
		title:      &SpeechTitle{Text: "单卡 ASR 部署方案"},
	})
	result, err := uc.Process(context.Background(), SpeechSource{Audio: []byte("audio"), MimeType: "audio/wav"}, 24)
	if err != nil {
		t.Fatalf("Process() error = %v", err)
	}
	if result.Title.Text != "单卡 ASR 部署方案" {
		t.Fatalf("Process() title = %q", result.Title.Text)
	}
}

func TestSpeechUsecaseRejectsUnsafeAudioURI(t *testing.T) {
	uc := NewSpeechUsecase(speechRepoStub{})
	_, err := uc.Transcribe(context.Background(), SpeechSource{AudioURI: "http://169.254.169.254/latest/meta-data"})
	if err == nil {
		t.Fatal("Transcribe() expected an error")
	}
}

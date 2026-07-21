package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	inferencev1 "astraflow-api/api/astraflow/inference/v1"
)

func TestCleanTitle(t *testing.T) {
	got := cleanTitle("“单卡部署 ASR 与标题模型”\n额外解释", 12)
	if got != "单卡部署 ASR 与标题" {
		t.Fatalf("cleanTitle() = %q", got)
	}
}

func TestHostAllowedRequiresConfiguredSuffix(t *testing.T) {
	if hostAllowed("bucket.example.com", nil) {
		t.Fatal("hostAllowed() accepted a host without an allowlist")
	}
	if !hostAllowed("bucket.example.com", []string{"example.com"}) {
		t.Fatal("hostAllowed() rejected a subdomain of an allowed suffix")
	}
	if hostAllowed("example.com.attacker.test", []string{"example.com"}) {
		t.Fatal("hostAllowed() accepted a suffix confusion host")
	}
}

func TestSplitRunesPreservesUnicode(t *testing.T) {
	got := splitRunes("甲乙丙丁戊", 2)
	if len(got) != 3 || got[0] != "甲乙" || got[2] != "戊" {
		t.Fatalf("splitRunes() = %#v", got)
	}
}

func TestTranscribeUsesDefaultJSONResponseFormat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if err := request.ParseMultipartForm(1024 * 1024); err != nil {
			t.Fatalf("ParseMultipartForm() error = %v", err)
		}
		if got := request.FormValue("model"); got != defaultASRModel {
			t.Fatalf("model = %q", got)
		}
		if got := request.FormValue("response_format"); got != "" {
			t.Fatalf("response_format = %q, want omitted", got)
		}
		file, header, err := request.FormFile("file")
		if err != nil {
			t.Fatalf("FormFile() error = %v", err)
		}
		defer file.Close()
		if header.Filename != "audio.wav" {
			t.Fatalf("filename = %q", header.Filename)
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]string{"text": "测试成功"})
	}))
	defer server.Close()

	gateway := &gateway{
		httpClient: &http.Client{},
		asrBaseURL: server.URL,
		asrModel:   defaultASRModel,
	}
	reply, err := gateway.Transcribe(context.Background(), &inferencev1.TranscribeRequest{
		Source:   &inferencev1.TranscribeRequest_Audio{Audio: []byte("RIFF-test-WAVE")},
		MimeType: "audio/wav",
	})
	if err != nil {
		t.Fatalf("Transcribe() error = %v", err)
	}
	if reply.GetTranscript() != "测试成功" {
		t.Fatalf("transcript = %q", reply.GetTranscript())
	}
}

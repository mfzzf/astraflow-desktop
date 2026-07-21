package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	inferencev1 "astraflow-api/api/astraflow/inference/v1"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	defaultListenAddress = "0.0.0.0:9100"
	defaultASRModel      = "Qwen/Qwen3-ASR-1.7B"
	defaultTitleModel    = "Qwen/Qwen3-8B-AWQ"
	maxAudioBytes        = 48 * 1024 * 1024
	maxMessageBytes      = 64 * 1024 * 1024
)

type gateway struct {
	inferencev1.UnimplementedInferenceServiceServer

	httpClient        *http.Client
	downloadClient    *http.Client
	asrBaseURL        string
	titleBaseURL      string
	asrModel          string
	titleModel        string
	allowedAudioHosts []string
}

type transcriptionResponse struct {
	Text     string  `json:"text"`
	Language string  `json:"language"`
	Duration float64 `json:"duration"`
}

type chatCompletionResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

func main() {
	listenAddress := envOrDefault("INFERENCE_GATEWAY_ADDR", defaultListenAddress)
	requestTimeout := durationEnvOrDefault("MODEL_REQUEST_TIMEOUT", 5*time.Minute)
	allowedAudioHosts := splitCSV(os.Getenv("AUDIO_URI_ALLOWED_HOST_SUFFIXES"))
	listener, err := net.Listen("tcp", listenAddress)
	if err != nil {
		panic(err)
	}
	server := grpc.NewServer(
		grpc.MaxRecvMsgSize(maxMessageBytes),
		grpc.MaxSendMsgSize(maxMessageBytes),
	)
	inferencev1.RegisterInferenceServiceServer(server, &gateway{
		httpClient:        &http.Client{Timeout: requestTimeout},
		downloadClient:    newDownloadClient(requestTimeout, allowedAudioHosts),
		asrBaseURL:        strings.TrimRight(envOrDefault("ASR_BASE_URL", "http://127.0.0.1:8001"), "/"),
		titleBaseURL:      strings.TrimRight(envOrDefault("TITLE_BASE_URL", "http://127.0.0.1:8002"), "/"),
		asrModel:          envOrDefault("ASR_MODEL", defaultASRModel),
		titleModel:        envOrDefault("TITLE_MODEL", defaultTitleModel),
		allowedAudioHosts: allowedAudioHosts,
	})
	slog.Info("inference gateway listening", "addr", listenAddress)
	if err := server.Serve(listener); err != nil {
		panic(err)
	}
}

func (g *gateway) Transcribe(ctx context.Context, req *inferencev1.TranscribeRequest) (*inferencev1.TranscribeReply, error) {
	audio, filename, err := g.loadAudio(ctx, req)
	if err != nil {
		return nil, err
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to create transcription request")
	}
	if _, err := part.Write(audio); err != nil {
		return nil, status.Error(codes.Internal, "failed to encode transcription request")
	}
	_ = writer.WriteField("model", g.asrModel)
	_ = writer.WriteField("response_format", "verbose_json")
	if hint := strings.TrimSpace(req.GetLanguageHint()); hint != "" {
		_ = writer.WriteField("language", hint)
	}
	if err := writer.Close(); err != nil {
		return nil, status.Error(codes.Internal, "failed to finish transcription request")
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, g.asrBaseURL+"/v1/audio/transcriptions", &body)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to create transcription request")
	}
	httpReq.Header.Set("Content-Type", writer.FormDataContentType())
	var response transcriptionResponse
	if err := g.doJSON(httpReq, &response); err != nil {
		return nil, status.Error(codes.Unavailable, err.Error())
	}
	if strings.TrimSpace(response.Text) == "" {
		return nil, status.Error(codes.Internal, "ASR model returned an empty transcript")
	}
	return &inferencev1.TranscribeReply{
		Transcript:       strings.TrimSpace(response.Text),
		DetectedLanguage: strings.TrimSpace(response.Language),
		DurationMs:       int64(response.Duration * 1000),
		Model:            g.asrModel,
	}, nil
}

func (g *gateway) GenerateTitle(ctx context.Context, req *inferencev1.GenerateTitleRequest) (*inferencev1.GenerateTitleReply, error) {
	transcript := strings.TrimSpace(req.GetTranscript())
	if transcript == "" {
		return nil, status.Error(codes.InvalidArgument, "transcript is required")
	}
	if utf8.RuneCountInString(transcript) > 120_000 {
		return nil, status.Error(codes.ResourceExhausted, "transcript exceeds 120000 characters")
	}
	maxCharacters := req.GetMaxCharacters()
	titleInput := transcript
	chunks := splitRunes(transcript, 6000)
	if len(chunks) > 1 {
		summaries := make([]string, 0, len(chunks))
		for index, chunk := range chunks {
			prompt := fmt.Sprintf("概括下面语音转写片段的核心主题、关键对象和结论。只输出一行简洁摘要。\n\n片段 %d/%d：\n%s\n\n/no_think", index+1, len(chunks), chunk)
			summary, err := g.complete(ctx, "你是忠实的会议记录编辑，禁止补充原文没有的信息。", prompt, 256)
			if err != nil {
				return nil, err
			}
			summaries = append(summaries, strings.TrimSpace(summary))
		}
		titleInput = strings.Join(summaries, "\n")
	}
	titleRequirement := "请生成简洁标题"
	if maxCharacters > 0 {
		titleRequirement = fmt.Sprintf("标题最多 %d 个字符", maxCharacters)
	}
	prompt := fmt.Sprintf("请根据下面的语音转写或分段摘要生成一个准确、具体的标题。%s；只输出标题，不加引号、序号或解释。\n\n内容：\n%s\n\n/no_think", titleRequirement, titleInput)
	content, err := g.complete(ctx, "你是标题编辑，保留核心主题和关键对象，禁止编造内容中不存在的信息。", prompt, 256)
	if err != nil {
		return nil, err
	}
	title := cleanTitle(content, int(maxCharacters))
	if title == "" {
		return nil, status.Error(codes.Internal, "title model returned an empty title")
	}
	return &inferencev1.GenerateTitleReply{Title: title, Model: g.titleModel}, nil
}

func (g *gateway) complete(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (string, error) {
	payload := map[string]any{
		"model": g.titleModel,
		"messages": []map[string]string{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userPrompt},
		},
		"temperature":          0.2,
		"top_p":                0.8,
		"max_tokens":           maxTokens,
		"chat_template_kwargs": map[string]any{"enable_thinking": false},
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", status.Error(codes.Internal, "failed to encode title request")
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, g.titleBaseURL+"/v1/chat/completions", bytes.NewReader(encoded))
	if err != nil {
		return "", status.Error(codes.Internal, "failed to create title request")
	}
	httpReq.Header.Set("Content-Type", "application/json")
	var response chatCompletionResponse
	if err := g.doJSON(httpReq, &response); err != nil {
		return "", status.Error(codes.Unavailable, err.Error())
	}
	if len(response.Choices) == 0 {
		return "", status.Error(codes.Internal, "title model returned no choices")
	}
	return response.Choices[0].Message.Content, nil
}

func (g *gateway) loadAudio(ctx context.Context, req *inferencev1.TranscribeRequest) ([]byte, string, error) {
	switch source := req.GetSource().(type) {
	case *inferencev1.TranscribeRequest_Audio:
		if len(source.Audio) == 0 {
			return nil, "", status.Error(codes.InvalidArgument, "audio is empty")
		}
		if len(source.Audio) > maxAudioBytes {
			return nil, "", status.Error(codes.ResourceExhausted, "audio exceeds 48 MiB")
		}
		return source.Audio, filenameForMimeType(req.GetMimeType()), nil
	case *inferencev1.TranscribeRequest_AudioUri:
		parsed, err := url.Parse(strings.TrimSpace(source.AudioUri))
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
			return nil, "", status.Error(codes.InvalidArgument, "audio_uri must be a signed HTTPS URL")
		}
		if !hostAllowed(parsed.Hostname(), g.allowedAudioHosts) {
			return nil, "", status.Error(codes.PermissionDenied, "audio_uri host is not allowed")
		}
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
		if err != nil {
			return nil, "", status.Error(codes.InvalidArgument, "audio_uri is invalid")
		}
		resp, err := g.downloadClient.Do(httpReq)
		if err != nil {
			return nil, "", status.Error(codes.Unavailable, "failed to download audio")
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, "", status.Errorf(codes.InvalidArgument, "audio_uri returned HTTP %d", resp.StatusCode)
		}
		limited := io.LimitReader(resp.Body, maxAudioBytes+1)
		audio, err := io.ReadAll(limited)
		if err != nil {
			return nil, "", status.Error(codes.Unavailable, "failed to read audio")
		}
		if len(audio) > maxAudioBytes {
			return nil, "", status.Error(codes.ResourceExhausted, "audio exceeds 48 MiB")
		}
		filename := parsed.Path
		if index := strings.LastIndex(filename, "/"); index >= 0 {
			filename = filename[index+1:]
		}
		if filename == "" {
			filename = filenameForMimeType(req.GetMimeType())
		}
		return audio, filename, nil
	default:
		return nil, "", status.Error(codes.InvalidArgument, "audio or audio_uri is required")
	}
}

func (g *gateway) doJSON(req *http.Request, target any) error {
	resp, err := g.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("model request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("model returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(message)))
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2*1024*1024)).Decode(target); err != nil {
		return fmt.Errorf("invalid model response: %w", err)
	}
	return nil
}

func cleanTitle(value string, maxCharacters int) string {
	value = strings.TrimSpace(value)
	if newline := strings.IndexByte(value, '\n'); newline >= 0 {
		value = value[:newline]
	}
	value = strings.Trim(strings.TrimSpace(value), "\"'“”‘’《》")
	runes := []rune(strings.TrimSpace(value))
	if maxCharacters > 0 && len(runes) > maxCharacters {
		runes = runes[:maxCharacters]
	}
	value = strings.TrimSpace(string(runes))
	if !utf8.ValidString(value) {
		return ""
	}
	return value
}

func splitRunes(value string, chunkSize int) []string {
	runes := []rune(value)
	if chunkSize <= 0 || len(runes) <= chunkSize {
		return []string{value}
	}
	chunks := make([]string, 0, (len(runes)+chunkSize-1)/chunkSize)
	for start := 0; start < len(runes); start += chunkSize {
		end := start + chunkSize
		if end > len(runes) {
			end = len(runes)
		}
		chunks = append(chunks, string(runes[start:end]))
	}
	return chunks
}

func filenameForMimeType(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "audio/mpeg", "audio/mp3":
		return "audio.mp3"
	case "audio/mp4", "audio/x-m4a":
		return "audio.m4a"
	case "audio/flac":
		return "audio.flac"
	case "audio/ogg":
		return "audio.ogg"
	default:
		return "audio.wav"
	}
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func durationEnvOrDefault(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	duration, err := time.ParseDuration(value)
	if err == nil && duration > 0 {
		return duration
	}
	if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	return fallback
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if part = strings.ToLower(strings.TrimSpace(part)); part != "" {
			result = append(result, strings.TrimPrefix(part, "."))
		}
	}
	return result
}

func hostAllowed(host string, suffixes []string) bool {
	host = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(host), "."))
	for _, suffix := range suffixes {
		if host == suffix || strings.HasSuffix(host, "."+suffix) {
			return true
		}
	}
	return false
}

func newDownloadClient(timeout time.Duration, allowedHosts []string) *http.Client {
	return &http.Client{
		Timeout: timeout,
		CheckRedirect: func(req *http.Request, _ []*http.Request) error {
			if req.URL.Scheme != "https" || !hostAllowed(req.URL.Hostname(), allowedHosts) {
				return errors.New("audio_uri redirect target is not allowed")
			}
			return nil
		},
	}
}

package biz

import (
	"context"
	"net/url"
	"strings"
	"unicode/utf8"

	kerrors "github.com/go-kratos/kratos/v3/errors"
)

const (
	MaxSpeechAudioBytes      = 48 * 1024 * 1024
	MaxSpeechTranscriptRunes = 120_000
)

type SpeechSource struct {
	Audio        []byte
	AudioURI     string
	MimeType     string
	LanguageHint string
}

type Transcript struct {
	Text             string
	DetectedLanguage string
	DurationMS       int64
	Model            string
}

type SpeechTitle struct {
	Text  string
	Model string
}

type ProcessedSpeech struct {
	Transcript *Transcript
	Title      *SpeechTitle
}

type SpeechRepo interface {
	Transcribe(context.Context, SpeechSource) (*Transcript, error)
	GenerateTitle(context.Context, string, string, uint32) (*SpeechTitle, error)
}

type SpeechUsecase struct {
	repo SpeechRepo
}

func NewSpeechUsecase(repo SpeechRepo) *SpeechUsecase {
	return &SpeechUsecase{repo: repo}
}

func (uc *SpeechUsecase) Transcribe(ctx context.Context, source SpeechSource) (*Transcript, error) {
	normalized, err := validateSpeechSource(source)
	if err != nil {
		return nil, err
	}
	result, err := uc.repo.Transcribe(ctx, normalized)
	if err != nil {
		return nil, kerrors.ServiceUnavailable("INFERENCE_UNAVAILABLE", "speech transcription is temporarily unavailable")
	}
	return result, nil
}

func (uc *SpeechUsecase) GenerateTitle(ctx context.Context, transcript, language string, maxCharacters uint32) (*SpeechTitle, error) {
	transcript = strings.TrimSpace(transcript)
	if transcript == "" {
		return nil, kerrors.BadRequest("INVALID_ARGUMENT", "transcript is required")
	}
	if !utf8.ValidString(transcript) {
		return nil, kerrors.BadRequest("INVALID_ARGUMENT", "transcript must be valid UTF-8")
	}
	if utf8.RuneCountInString(transcript) > MaxSpeechTranscriptRunes {
		return nil, kerrors.BadRequest("INVALID_ARGUMENT", "transcript is too long")
	}
	result, err := uc.repo.GenerateTitle(ctx, transcript, strings.TrimSpace(language), maxCharacters)
	if err != nil {
		return nil, kerrors.ServiceUnavailable("INFERENCE_UNAVAILABLE", "title generation is temporarily unavailable")
	}
	return result, nil
}

func (uc *SpeechUsecase) Process(ctx context.Context, source SpeechSource, maxTitleCharacters uint32) (*ProcessedSpeech, error) {
	transcript, err := uc.Transcribe(ctx, source)
	if err != nil {
		return nil, err
	}
	title, err := uc.GenerateTitle(ctx, transcript.Text, transcript.DetectedLanguage, maxTitleCharacters)
	if err != nil {
		return nil, err
	}
	return &ProcessedSpeech{Transcript: transcript, Title: title}, nil
}

func validateSpeechSource(source SpeechSource) (SpeechSource, error) {
	source.AudioURI = strings.TrimSpace(source.AudioURI)
	source.MimeType = strings.ToLower(strings.TrimSpace(source.MimeType))
	source.LanguageHint = strings.TrimSpace(source.LanguageHint)
	if len(source.Audio) == 0 && source.AudioURI == "" {
		return SpeechSource{}, kerrors.BadRequest("INVALID_ARGUMENT", "audio or audio_uri is required")
	}
	if len(source.Audio) > 0 && source.AudioURI != "" {
		return SpeechSource{}, kerrors.BadRequest("INVALID_ARGUMENT", "audio and audio_uri are mutually exclusive")
	}
	if len(source.Audio) > MaxSpeechAudioBytes {
		return SpeechSource{}, kerrors.BadRequest("INVALID_ARGUMENT", "audio is too large; use a signed HTTPS audio_uri")
	}
	if source.AudioURI != "" {
		parsed, err := url.Parse(source.AudioURI)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
			return SpeechSource{}, kerrors.BadRequest("INVALID_ARGUMENT", "audio_uri must be a signed HTTPS URL")
		}
	}
	return source, nil
}

package data

import (
	"context"
	"errors"

	inferencev1 "astraflow-api/api/astraflow/inference/v1"
	"astraflow-api/internal/biz"
)

var errInferenceNotConfigured = errors.New("inference gRPC endpoint is not configured")

type speechRepo struct {
	data   *Data
	client inferencev1.InferenceServiceClient
}

func NewSpeechRepo(data *Data) biz.SpeechRepo {
	var client inferencev1.InferenceServiceClient
	if data.inferenceConn != nil {
		client = inferencev1.NewInferenceServiceClient(data.inferenceConn)
	}
	return &speechRepo{data: data, client: client}
}

func (r *speechRepo) Transcribe(ctx context.Context, source biz.SpeechSource) (*biz.Transcript, error) {
	if r.client == nil {
		return nil, errInferenceNotConfigured
	}
	request := &inferencev1.TranscribeRequest{
		MimeType:     source.MimeType,
		LanguageHint: source.LanguageHint,
	}
	if len(source.Audio) > 0 {
		request.Source = &inferencev1.TranscribeRequest_Audio{Audio: source.Audio}
	} else {
		request.Source = &inferencev1.TranscribeRequest_AudioUri{AudioUri: source.AudioURI}
	}
	callCtx, cancel := context.WithTimeout(ctx, r.data.inferenceTimeout)
	defer cancel()
	reply, err := r.client.Transcribe(callCtx, request)
	if err != nil {
		return nil, err
	}
	return &biz.Transcript{
		Text:             reply.GetTranscript(),
		DetectedLanguage: reply.GetDetectedLanguage(),
		DurationMS:       reply.GetDurationMs(),
		Model:            reply.GetModel(),
	}, nil
}

func (r *speechRepo) GenerateTitle(ctx context.Context, transcript, language string, maxCharacters uint32) (*biz.SpeechTitle, error) {
	if r.client == nil {
		return nil, errInferenceNotConfigured
	}
	callCtx, cancel := context.WithTimeout(ctx, r.data.inferenceTimeout)
	defer cancel()
	reply, err := r.client.GenerateTitle(callCtx, &inferencev1.GenerateTitleRequest{
		Transcript:    transcript,
		Language:      language,
		MaxCharacters: maxCharacters,
	})
	if err != nil {
		return nil, err
	}
	return &biz.SpeechTitle{Text: reply.GetTitle(), Model: reply.GetModel()}, nil
}

package service

import (
	"context"

	v1 "astraflow-api/api/astraflow/v1"
	"astraflow-api/internal/biz"
)

type SpeechService struct {
	v1.UnimplementedSpeechServiceServer

	uc *biz.SpeechUsecase
}

func NewSpeechService(uc *biz.SpeechUsecase) *SpeechService {
	return &SpeechService{uc: uc}
}

func (s *SpeechService) Transcribe(ctx context.Context, req *v1.TranscribeSpeechRequest) (*v1.TranscribeSpeechReply, error) {
	result, err := s.uc.Transcribe(ctx, transcribeSpeechSource(req))
	if err != nil {
		return nil, err
	}
	return &v1.TranscribeSpeechReply{
		Transcript:       result.Text,
		DetectedLanguage: result.DetectedLanguage,
		DurationMs:       result.DurationMS,
		Model:            result.Model,
	}, nil
}

func (s *SpeechService) GenerateTitle(ctx context.Context, req *v1.GenerateSpeechTitleRequest) (*v1.GenerateSpeechTitleReply, error) {
	result, err := s.uc.GenerateTitle(ctx, req.GetTranscript(), req.GetLanguage(), req.GetMaxCharacters())
	if err != nil {
		return nil, err
	}
	return &v1.GenerateSpeechTitleReply{Title: result.Text, Model: result.Model}, nil
}

func (s *SpeechService) Process(ctx context.Context, req *v1.ProcessSpeechRequest) (*v1.ProcessSpeechReply, error) {
	result, err := s.uc.Process(ctx, processSpeechSource(req), req.GetMaxTitleCharacters())
	if err != nil {
		return nil, err
	}
	return &v1.ProcessSpeechReply{
		Transcript:       result.Transcript.Text,
		Title:            result.Title.Text,
		DetectedLanguage: result.Transcript.DetectedLanguage,
		DurationMs:       result.Transcript.DurationMS,
		AsrModel:         result.Transcript.Model,
		TitleModel:       result.Title.Model,
	}, nil
}

func transcribeSpeechSource(req *v1.TranscribeSpeechRequest) biz.SpeechSource {
	source := biz.SpeechSource{MimeType: req.GetMimeType(), LanguageHint: req.GetLanguageHint()}
	switch value := req.GetSource().(type) {
	case *v1.TranscribeSpeechRequest_Audio:
		source.Audio = value.Audio
	case *v1.TranscribeSpeechRequest_AudioUri:
		source.AudioURI = value.AudioUri
	}
	return source
}

func processSpeechSource(req *v1.ProcessSpeechRequest) biz.SpeechSource {
	source := biz.SpeechSource{MimeType: req.GetMimeType(), LanguageHint: req.GetLanguageHint()}
	switch value := req.GetSource().(type) {
	case *v1.ProcessSpeechRequest_Audio:
		source.Audio = value.Audio
	case *v1.ProcessSpeechRequest_AudioUri:
		source.AudioURI = value.AudioUri
	}
	return source
}

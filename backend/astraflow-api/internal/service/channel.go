package service

import (
	"context"
	"strconv"
	"strings"

	v1 "astraflow-api/api/astraflow/v1"
	"astraflow-api/internal/biz"

	"github.com/go-kratos/kratos/v3/transport"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type ChannelService struct {
	v1.UnimplementedChannelServiceServer
	uc *biz.ChannelUsecase
}

func NewChannelService(uc *biz.ChannelUsecase) *ChannelService {
	return &ChannelService{uc: uc}
}

func (s *ChannelService) GetChannelRuntimeConfig(ctx context.Context, req *v1.GetChannelRuntimeConfigRequest) (*v1.ChannelRuntimeConfig, error) {
	channel, err := s.uc.GetRuntimeConfig(ctx, req.GetSlug())
	if err != nil {
		return nil, err
	}
	return &v1.ChannelRuntimeConfig{
		Slug: channel.Slug, Name: channel.Name, OauthClientId: channel.OAuthClientID,
		EnabledFeatures: channel.EnabledFeatures, RestrictModels: channel.RestrictModels,
		AllowedModelIds: channel.AllowedModelIDs, Revision: channel.Revision,
	}, nil
}

func (s *ChannelService) StartChannelOAuth(ctx context.Context, req *v1.StartChannelOAuthRequest) (*v1.StartChannelOAuthResponse, error) {
	authorizationURL, state, expiresAt, err := s.uc.StartOAuth(ctx, req.GetSlug(), req.GetRedirectUri())
	if err != nil {
		return nil, err
	}
	return &v1.StartChannelOAuthResponse{
		AuthorizationUrl: authorizationURL, State: state, ExpiresAt: timestamppb.New(expiresAt),
	}, nil
}

func (s *ChannelService) ExchangeChannelOAuthCode(ctx context.Context, req *v1.ExchangeChannelOAuthCodeRequest) (*v1.ChannelOAuthTokens, error) {
	tokens, err := s.uc.ExchangeOAuthCode(ctx, req.GetSlug(), req.GetState(), req.GetCode(), req.GetRedirectUri())
	if err != nil {
		return nil, err
	}
	return toChannelOAuthTokens(tokens), nil
}

func (s *ChannelService) RefreshChannelOAuthToken(ctx context.Context, req *v1.RefreshChannelOAuthTokenRequest) (*v1.ChannelOAuthTokens, error) {
	tokens, err := s.uc.RefreshOAuthToken(ctx, req.GetSlug(), req.GetRefreshToken())
	if err != nil {
		return nil, err
	}
	return toChannelOAuthTokens(tokens), nil
}

func (s *ChannelService) ListChannels(ctx context.Context, req *v1.ListChannelsRequest) (*v1.ListChannelsResponse, error) {
	pageSize := int(req.GetPageSize())
	offset := parsePageToken(req.GetPageToken())
	channels, total, err := s.uc.ListChannels(ctx, authorizationFromContext(ctx), biz.ChannelListOptions{
		Query: req.GetQuery(), Status: req.GetStatus(), Offset: offset, Limit: pageSize,
	})
	if err != nil {
		return nil, err
	}
	items := make([]*v1.Channel, 0, len(channels))
	for _, channel := range channels {
		items = append(items, toChannelDTO(channel))
	}
	nextToken := ""
	actualPageSize := pageSize
	if actualPageSize <= 0 || actualPageSize > 100 {
		actualPageSize = 25
	}
	if offset+len(items) < total {
		nextToken = strconv.Itoa(offset + actualPageSize)
	}
	return &v1.ListChannelsResponse{Channels: items, NextPageToken: nextToken, TotalSize: int32(total)}, nil
}

func (s *ChannelService) GetChannel(ctx context.Context, req *v1.GetChannelRequest) (*v1.Channel, error) {
	channel, err := s.uc.GetChannel(ctx, authorizationFromContext(ctx), req.GetChannelId())
	if err != nil {
		return nil, err
	}
	return toChannelDTO(channel), nil
}

func (s *ChannelService) CreateChannel(ctx context.Context, req *v1.CreateChannelRequest) (*v1.Channel, error) {
	channel, err := s.uc.CreateChannel(ctx, authorizationFromContext(ctx), &biz.Channel{
		Slug: req.GetSlug(), Name: req.GetName(), Status: req.GetStatus(),
		OAuthClientID: req.GetOauthClientId(), OAuthClientSecret: req.GetOauthClientSecret(),
		EnabledFeatures: req.GetEnabledFeatures(), RestrictModels: req.GetRestrictModels(),
		AllowedModelIDs: req.GetAllowedModelIds(),
	})
	if err != nil {
		return nil, err
	}
	return toChannelDTO(channel), nil
}

func (s *ChannelService) UpdateChannel(ctx context.Context, req *v1.UpdateChannelRequest) (*v1.Channel, error) {
	channel, err := s.uc.UpdateChannel(ctx, authorizationFromContext(ctx), &biz.Channel{
		ID: req.GetChannelId(), Slug: req.GetSlug(), Name: req.GetName(), Status: req.GetStatus(),
		OAuthClientID: req.GetOauthClientId(), OAuthClientSecret: req.GetOauthClientSecret(),
		EnabledFeatures: req.GetEnabledFeatures(), RestrictModels: req.GetRestrictModels(),
		AllowedModelIDs: req.GetAllowedModelIds(),
	}, req.GetClearOauthClientSecret())
	if err != nil {
		return nil, err
	}
	return toChannelDTO(channel), nil
}

func (s *ChannelService) DeleteChannel(ctx context.Context, req *v1.DeleteChannelRequest) (*emptypb.Empty, error) {
	if err := s.uc.DeleteChannel(ctx, authorizationFromContext(ctx), req.GetChannelId()); err != nil {
		return nil, err
	}
	return &emptypb.Empty{}, nil
}

func authorizationFromContext(ctx context.Context) string {
	if tr, ok := transport.FromServerContext(ctx); ok {
		return tr.RequestHeader().Get("Authorization")
	}
	return ""
}

func parsePageToken(token string) int {
	offset, err := strconv.Atoi(strings.TrimSpace(token))
	if err != nil || offset < 0 {
		return 0
	}
	return offset
}

func toChannelDTO(channel *biz.Channel) *v1.Channel {
	return &v1.Channel{
		Id: channel.ID, Slug: channel.Slug, Name: channel.Name, Status: channel.Status,
		OauthClientId:               channel.OAuthClientID,
		OauthClientSecretConfigured: channel.OAuthClientSecretConfigured,
		EnabledFeatures:             channel.EnabledFeatures, RestrictModels: channel.RestrictModels,
		AllowedModelIds: channel.AllowedModelIDs, CreatedAt: timestamppb.New(channel.CreatedAt),
		UpdatedAt: timestamppb.New(channel.UpdatedAt),
	}
}

func toChannelOAuthTokens(tokens *biz.OAuthTokens) *v1.ChannelOAuthTokens {
	return &v1.ChannelOAuthTokens{
		AccessToken: tokens.AccessToken, RefreshToken: tokens.RefreshToken,
		TokenType: tokens.TokenType, ExpiresIn: tokens.ExpiresIn, IdToken: tokens.IDToken,
	}
}

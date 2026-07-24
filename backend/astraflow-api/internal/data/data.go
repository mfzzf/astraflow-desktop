package data

import (
	"astraflow-api/internal/conf"
	"context"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-kratos/kratos/v3/log"
	"github.com/google/wire"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// ProviderSet is data providers.
var ProviderSet = wire.NewSet(
	NewData,
	NewHealthRepo,
	NewExpertRepo,
	NewFeedbackRepo,
	NewChannelRepo,
	NewAdminVerifier,
	NewChannelOAuthClient,
	NewMarketplaceRepo,
	NewUCloudOAuthVerifier,
	NewAnalyticsRepo,
	NewSpeechRepo,
)

// Data .
type Data struct {
	db                   *pgxpool.Pool
	marketHTTPClient     *http.Client
	ucloudMarketEndpoint string
	inferenceConn        *grpc.ClientConn
	inferenceTimeout     time.Duration
}

const defaultUCloudMarketEndpoint = "https://api.ucloud.cn/"

// NewData .
func NewData(c *conf.Data) (*Data, func(), error) {
	var pool *pgxpool.Pool
	if c != nil && c.Database != nil && c.Database.Source != "" {
		config, err := pgxpool.ParseConfig(c.Database.Source)
		if err != nil {
			return nil, nil, err
		}
		pool, err = pgxpool.NewWithConfig(context.Background(), config)
		if err != nil {
			return nil, nil, err
		}
	}

	var inferenceConn *grpc.ClientConn
	inferenceTimeout := 5 * time.Minute
	if c != nil && c.Inference != nil {
		if c.Inference.Timeout != nil {
			inferenceTimeout = c.Inference.Timeout.AsDuration()
		}
		if addr := strings.TrimSpace(c.Inference.Addr); addr != "" {
			maxMessageBytes := int(c.Inference.MaxMessageBytes)
			if maxMessageBytes <= 0 {
				maxMessageBytes = 64 * 1024 * 1024
			}
			var err error
			inferenceConn, err = grpc.NewClient(
				addr,
				grpc.WithTransportCredentials(insecure.NewCredentials()),
				grpc.WithDefaultCallOptions(
					grpc.MaxCallRecvMsgSize(maxMessageBytes),
					grpc.MaxCallSendMsgSize(maxMessageBytes),
				),
			)
			if err != nil {
				if pool != nil {
					pool.Close()
				}
				return nil, nil, err
			}
		}
	}

	cleanup := func() {
		log.Info("closing the data resources")
		if pool != nil {
			pool.Close()
		}
		if inferenceConn != nil {
			_ = inferenceConn.Close()
		}
	}
	marketEndpoint := strings.TrimSpace(os.Getenv("ASTRAFLOW_UCLOUD_API_ENDPOINT"))
	if marketEndpoint == "" {
		marketEndpoint = defaultUCloudMarketEndpoint
	}

	return &Data{
		db:                   pool,
		marketHTTPClient:     &http.Client{Timeout: 15 * time.Second},
		ucloudMarketEndpoint: marketEndpoint,
		inferenceConn:        inferenceConn,
		inferenceTimeout:     inferenceTimeout,
	}, cleanup, nil
}

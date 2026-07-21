package server

import (
	"log/slog"
	stdhttp "net/http"

	v1 "astraflow-api/api/astraflow/v1"
	"astraflow-api/internal/conf"
	"astraflow-api/internal/service"

	"github.com/go-kratos/kratos/v3/middleware/logging"
	"github.com/go-kratos/kratos/v3/middleware/recovery"
	"github.com/go-kratos/kratos/v3/middleware/validate"
	"github.com/go-kratos/kratos/v3/transport/http"

	"go.einride.tech/aip/fieldbehavior"
	"google.golang.org/protobuf/proto"
)

// NewHTTPServer new an HTTP server.
func NewHTTPServer(
	c *conf.Server,
	logger *slog.Logger,
	health *service.HealthService,
	expert *service.ExpertService,
	feedback *service.FeedbackService,
	channel *service.ChannelService,
	marketplace *service.MarketplaceService,
	analytics *service.AnalyticsService,
	speech *service.SpeechService,
) *http.Server {
	var opts = []http.ServerOption{
		http.ResponseEncoder(func(w stdhttp.ResponseWriter, request *stdhttp.Request, value any) error {
			if request.Method == stdhttp.MethodPost && request.URL.Path == "/v1/feedbacks" {
				w.WriteHeader(stdhttp.StatusCreated)
			}
			return http.DefaultResponseEncoder(w, request, value)
		}),
		http.Middleware(
			logging.Server(logger),
			recovery.Recovery(),
			validate.Validator(func(req any) error {
				if msg, ok := req.(proto.Message); ok {
					if err := fieldbehavior.ValidateRequiredFields(msg); err != nil {
						return err
					}
				}
				return nil
			}),
		),
	}
	if c.Http.Network != "" {
		opts = append(opts, http.Network(c.Http.Network))
	}
	if c.Http.Addr != "" {
		opts = append(opts, http.Address(c.Http.Addr))
	}
	if c.Http.Timeout != nil {
		opts = append(opts, http.Timeout(c.Http.Timeout.AsDuration()))
	}
	srv := http.NewServer(opts...)
	v1.RegisterHealthServiceHTTPServer(srv, health)
	v1.RegisterExpertServiceHTTPServer(srv, expert)
	v1.RegisterFeedbackServiceHTTPServer(srv, feedback)
	v1.RegisterChannelServiceHTTPServer(srv, channel)
	v1.RegisterMarketplaceServiceHTTPServer(srv, marketplace)
	v1.RegisterAnalyticsServiceHTTPServer(srv, analytics)
	v1.RegisterSpeechServiceHTTPServer(srv, speech)
	return srv
}

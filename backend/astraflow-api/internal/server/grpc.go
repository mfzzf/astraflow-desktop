package server

import (
	"log/slog"

	v1 "astraflow-api/api/astraflow/v1"
	"astraflow-api/internal/conf"
	"astraflow-api/internal/service"

	"github.com/go-kratos/kratos/v3/middleware/logging"
	"github.com/go-kratos/kratos/v3/middleware/recovery"
	"github.com/go-kratos/kratos/v3/transport/grpc"
)

// NewGRPCServer new a gRPC server.
func NewGRPCServer(
	c *conf.Server,
	logger *slog.Logger,
	health *service.HealthService,
	expert *service.ExpertService,
) *grpc.Server {
	var opts = []grpc.ServerOption{
		grpc.Middleware(
			logging.Server(logger),
			recovery.Recovery(),
		),
	}
	if c.Grpc.Network != "" {
		opts = append(opts, grpc.Network(c.Grpc.Network))
	}
	if c.Grpc.Addr != "" {
		opts = append(opts, grpc.Address(c.Grpc.Addr))
	}
	if c.Grpc.Timeout != nil {
		opts = append(opts, grpc.Timeout(c.Grpc.Timeout.AsDuration()))
	}
	srv := grpc.NewServer(opts...)
	v1.RegisterHealthServiceServer(srv, health)
	v1.RegisterExpertServiceServer(srv, expert)
	return srv
}

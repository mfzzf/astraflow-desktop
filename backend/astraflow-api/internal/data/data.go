package data

import (
	"astraflow-api/internal/conf"
	"context"

	"github.com/go-kratos/kratos/v3/log"
	"github.com/google/wire"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ProviderSet is data providers.
var ProviderSet = wire.NewSet(NewData, NewHealthRepo, NewExpertRepo)

// Data .
type Data struct {
	db *pgxpool.Pool
}

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
		if err := migrateExpertSchema(context.Background(), pool); err != nil {
			pool.Close()
			return nil, nil, err
		}
	}

	cleanup := func() {
		log.Info("closing the data resources")
		if pool != nil {
			pool.Close()
		}
	}
	return &Data{db: pool}, cleanup, nil
}

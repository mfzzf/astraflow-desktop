package data

import (
	"context"
	"fmt"
	"time"

	"astraflow-api/internal/biz"

	kerrors "github.com/go-kratos/kratos/v3/errors"
	"github.com/jackc/pgx/v5"
)

type analyticsRepo struct {
	data *Data
}

func NewAnalyticsRepo(data *Data) biz.AnalyticsRepo {
	return &analyticsRepo{data: data}
}

func (r *analyticsRepo) CollectEvents(ctx context.Context, events []*biz.AnalyticsEvent) (int, error) {
	if r.data.db == nil {
		return 0, fmt.Errorf("database is not configured")
	}
	batch := &pgx.Batch{}
	for _, event := range events {
		batch.Queue(`
			INSERT INTO analytics_events (
				event_id, session_id, anonymous_id, user_id_hash, event_name,
				event_type, path, target_type, target_id, target_label,
				channel_slug, client_version, platform, locale, screen_width,
				screen_height, occurred_at
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
			) ON CONFLICT (event_id) DO NOTHING
		`, event.EventID, event.SessionID, event.AnonymousID, event.UserIDHash,
			event.EventName, event.EventType, event.Path, event.TargetType,
			event.TargetID, event.TargetLabel, event.ChannelSlug, event.ClientVersion,
			event.Platform, event.Locale, event.ScreenWidth, event.ScreenHeight, event.OccurredAt)
	}

	results := r.data.db.SendBatch(ctx, batch)
	accepted := 0
	for range events {
		result, err := results.Exec()
		if err != nil {
			_ = results.Close()
			return 0, err
		}
		accepted += int(result.RowsAffected())
	}
	if err := results.Close(); err != nil {
		return 0, err
	}
	return accepted, nil
}

func (r *analyticsRepo) GetOverview(ctx context.Context, options biz.AnalyticsOverviewOptions) (*biz.AnalyticsOverview, error) {
	if r.data.db == nil {
		return nil, kerrors.ServiceUnavailable("DATABASE_UNAVAILABLE", "database is not configured")
	}
	overview := &biz.AnalyticsOverview{}
	identity := `COALESCE(NULLIF(user_id_hash, ''), anonymous_id)`
	filter := `occurred_at >= $1 AND occurred_at <= $2 AND ($3 = '' OR channel_slug = $3)`
	today := time.Date(options.EndAt.Year(), options.EndAt.Month(), options.EndAt.Day(), 0, 0, 0, 0, time.UTC)
	monthStart := today.AddDate(0, 0, -29)

	err := r.data.db.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE event_type = 'click')::bigint,
			count(DISTINCT `+identity+`)::bigint,
			count(DISTINCT session_id)::bigint,
			count(*) FILTER (
				WHERE event_type = 'click' AND occurred_at >= $4
			)::bigint
		FROM analytics_events
		WHERE `+filter,
		options.StartAt, options.EndAt, options.ChannelSlug, today,
	).Scan(&overview.TotalEvents, &overview.UniqueUsers, &overview.UniqueSessions, &overview.TodayEvents)
	if err != nil {
		return nil, err
	}

	err = r.data.db.QueryRow(ctx, `
		SELECT
			count(DISTINCT `+identity+`) FILTER (
				WHERE event_name = 'app.active' AND occurred_at >= $1
			)::bigint,
			count(DISTINCT `+identity+`) FILTER (
				WHERE event_name = 'app.active' AND occurred_at >= $2
			)::bigint,
			count(DISTINCT `+identity+`)::bigint,
			count(DISTINCT NULLIF(target_id, '')) FILTER (
				WHERE event_name IN (
					'studio.session.seen',
					'studio.session.created',
					'studio.session.active'
				)
			)::bigint,
			count(DISTINCT anonymous_id)::bigint
		FROM analytics_events
		WHERE occurred_at <= $3 AND ($4 = '' OR channel_slug = $4)
	`, today, monthStart, options.EndAt, options.ChannelSlug).Scan(
		&overview.DailyActiveUsers,
		&overview.MonthlyActiveUsers,
		&overview.TotalUsers,
		&overview.TotalStudioSessions,
		&overview.TotalTerminals,
	)
	if err != nil {
		return nil, err
	}

	trendRows, err := r.data.db.Query(ctx, `
		WITH days AS (
			SELECT generate_series(
				($1::timestamptz AT TIME ZONE 'UTC')::date::timestamp,
				($2::timestamptz AT TIME ZONE 'UTC')::date::timestamp,
				interval '1 day'
			) AS day
		), totals AS (
			SELECT date_trunc('day', occurred_at AT TIME ZONE 'UTC') AS day,
				count(*) FILTER (WHERE event_type = 'click')::bigint AS event_count,
				count(DISTINCT `+identity+`) FILTER (
					WHERE event_name = 'app.active'
				)::bigint AS unique_users
			FROM analytics_events
			WHERE `+filter+`
			GROUP BY 1
		)
		SELECT days.day, COALESCE(totals.event_count, 0), COALESCE(totals.unique_users, 0)
		FROM days LEFT JOIN totals ON totals.day = days.day
		ORDER BY days.day
	`, options.StartAt, options.EndAt, options.ChannelSlug)
	if err != nil {
		return nil, err
	}
	for trendRows.Next() {
		item := &biz.AnalyticsTrendPoint{}
		if err := trendRows.Scan(&item.Date, &item.EventCount, &item.UniqueUsers); err != nil {
			trendRows.Close()
			return nil, err
		}
		overview.Trend = append(overview.Trend, item)
	}
	if err := trendRows.Err(); err != nil {
		trendRows.Close()
		return nil, err
	}
	trendRows.Close()

	overview.TopEvents, err = r.queryRanked(ctx, `
		SELECT event_name, COALESCE(max(NULLIF(target_label, '')), event_name),
			count(*)::bigint, count(DISTINCT `+identity+`)::bigint
		FROM analytics_events
		WHERE `+filter+` AND event_type = 'click'
			AND (event_name LIKE 'sidebar.%' OR event_name LIKE 'composer.%')
		GROUP BY event_name ORDER BY count(*) DESC, event_name LIMIT 10
	`, options)
	if err != nil {
		return nil, err
	}
	overview.AgentUsage, err = r.queryRanked(ctx, `
		SELECT target_id, COALESCE(max(NULLIF(target_label, '')), target_id),
			count(*)::bigint, count(DISTINCT `+identity+`)::bigint
		FROM analytics_events
		WHERE `+filter+` AND event_name = 'agent.run' AND target_id <> ''
		GROUP BY target_id ORDER BY count(*) DESC, target_id LIMIT 10
	`, options)
	if err != nil {
		return nil, err
	}
	overview.ClientVersions, err = r.queryRanked(ctx, `
		WITH latest_terminal AS (
			SELECT DISTINCT ON (anonymous_id)
				anonymous_id,
				COALESCE(NULLIF(user_id_hash, ''), anonymous_id) AS user_identity,
				COALESCE(NULLIF(client_version, ''), 'unknown') AS value
			FROM analytics_events
			WHERE `+filter+` AND event_name = 'app.active'
			ORDER BY anonymous_id, occurred_at DESC
		)
		SELECT value, value, count(*)::bigint,
			count(DISTINCT user_identity)::bigint
		FROM latest_terminal
		GROUP BY value
		ORDER BY count(*) DESC, value
		LIMIT 10
	`, options)
	if err != nil {
		return nil, err
	}
	overview.Platforms, err = r.queryRanked(ctx, `
		WITH latest_terminal AS (
			SELECT DISTINCT ON (anonymous_id)
				anonymous_id,
				COALESCE(NULLIF(user_id_hash, ''), anonymous_id) AS user_identity,
				COALESCE(NULLIF(platform, ''), 'unknown') AS value
			FROM analytics_events
			WHERE `+filter+` AND event_name = 'app.active'
			ORDER BY anonymous_id, occurred_at DESC
		)
		SELECT value, value, count(*)::bigint,
			count(DISTINCT user_identity)::bigint
		FROM latest_terminal
		GROUP BY value
		ORDER BY count(*) DESC, value
		LIMIT 10
	`, options)
	if err != nil {
		return nil, err
	}
	return overview, nil
}

func (r *analyticsRepo) queryRanked(ctx context.Context, query string, options biz.AnalyticsOverviewOptions) ([]*biz.AnalyticsRankedItem, error) {
	rows, err := r.data.db.Query(ctx, query, options.StartAt, options.EndAt, options.ChannelSlug)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*biz.AnalyticsRankedItem, 0, 10)
	for rows.Next() {
		item := &biz.AnalyticsRankedItem{}
		if err := rows.Scan(&item.Key, &item.Label, &item.EventCount, &item.UniqueUsers); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

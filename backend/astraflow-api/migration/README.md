# AstraFlow API PostgreSQL Migrations

PostgreSQL schema and data migrations for the online AstraFlow API live in this
directory.

Naming:

- Use `0000_bootstrap_database.sql` only for first-time online database/user
  provisioning. It is run against an admin database, not the target app database.
- Use a monotonic numeric prefix: `0001_feature_name.up.sql`.
- Add the matching rollback file: `0001_feature_name.down.sql`.
- Keep schema scripts plain PostgreSQL SQL and runnable with `psql`.
- Use numbered `.mjs` files for source-driven data migrations that cannot be
  represented safely as static SQL, such as WorkBuddy expert exports.

First-time online PostgreSQL bootstrap:

```bash
export ADMIN_DATABASE_URL='postgres://ADMIN:PASSWORD@HOST:5432/postgres?sslmode=require'

psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v app_db=astraflow \
  -v app_user=astraflow_app \
  -v app_password='REPLACE_WITH_A_STRONG_PASSWORD' \
  -f backend/astraflow-api/migration/0000_bootstrap_database.sql
```

If the cloud provider does not allow `CREATE DATABASE` from SQL, create the
database in the provider console first, then run the same script; it will still
create the role when needed and grant database connection access.

Use the app user for all schema and data migrations:

```bash
export DATABASE_URL='postgres://astraflow_app:REPLACE_WITH_A_STRONG_PASSWORD@HOST:5432/astraflow?sslmode=require'

psql "$DATABASE_URL" -c 'SELECT current_database(), current_user;'
```

Apply schema:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0001_expert_system.up.sql
```

Rollback:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0001_expert_system.down.sql
```

Do not commit production database credentials. Pass them through environment variables or the deployment platform secret manager.

Expert Data Sync

`0002_sync_workbuddy_expert_data.mjs` imports the WorkBuddy expert export into
the PostgreSQL tables created by `0001`. It reads:

- `index.json` or `expert_center.json`
- `experts/*/prompts/*.md`
- `experts/*/manifest/agents/*.md`
- expert-local `skills/**/SKILL.md` and `mcp/.mcp.json` files, either under each expert root or under `manifest/`

It upserts categories and experts, then replaces each expert's child rows in
`expert_agents`, `expert_skills`, `expert_mcp_servers`, and
`expert_team_members`. Re-run it whenever the source export changes.

The current local WorkBuddy export is unpacked from the root `workbuddy.zip` into:

```text
backend/astraflow-api/migration/workbuddy/workbuddy-expert-center-downloaded-2026-07-07T15-30-46-670Z
```

`backend/astraflow-api/migration/workbuddy/` is ignored by git for now; unpack the
source zip locally before running the data sync.

Dry run:

```bash
node backend/astraflow-api/migration/0002_sync_workbuddy_expert_data.mjs \
  --source backend/astraflow-api/migration/workbuddy/workbuddy-expert-center-downloaded-2026-07-07T15-30-46-670Z \
  --dry-run
```

Sync to PostgreSQL:

```bash
ASTRAFLOW_EXPERT_DATABASE_URL="$DATABASE_URL" \
node backend/astraflow-api/migration/0002_sync_workbuddy_expert_data.mjs \
  --source backend/astraflow-api/migration/workbuddy/workbuddy-expert-center-downloaded-2026-07-07T15-30-46-670Z
```

The package shortcut is equivalent:

```bash
bun run experts:import -- --source backend/astraflow-api/migration/workbuddy/workbuddy-expert-center-downloaded-2026-07-07T15-30-46-670Z
```

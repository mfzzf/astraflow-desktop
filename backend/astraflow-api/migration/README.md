`0002_sync_workbuddy_expert_data.mjs` 就是数据同步脚本。顺序是：先保证 `0001` 表结构已跑完，再跑 `0002` 导入 WorkBuddy 数据。

在项目根目录执行：

```bash
cd /home/jason.mei/project/astraflow-desktop
```

先确认数据目录存在：

```bash
ls backend/astraflow-api/migration/workbuddy/workbuddy-expert-center-downloaded-2026-07-07T15-30-46-670Z
```

如果没有，先解压 `workbuddy.zip`：

```bash
mkdir -p backend/astraflow-api/migration/workbuddy

unzip -q workbuddy.zip \
  -d backend/astraflow-api/migration/workbuddy

unzip -q backend/astraflow-api/migration/workbuddy/workbuddy-expert-center-downloaded-2026-07-07T15-30-46-670Z.zip \
  -d backend/astraflow-api/migration/workbuddy
```

然后设置线上库连接串，注意用干净 DSN，不要带 GUI 参数：

```bash
export DATABASE_URL='postgres://astraflow_app:REPLACE_WITH_A_STRONG_PASSWORD@HOST:5432/astraflow?sslmode=require'
```

先 dry-run，不写数据库：

```bash
bun run experts:import -- \
  --source backend/astraflow-api/migration/workbuddy/workbuddy-expert-center-downloaded-2026-07-07T15-30-46-670Z \
  --dry-run
```

确认输出数量正常后，正式同步：

```bash
ASTRAFLOW_EXPERT_DATABASE_URL="$DATABASE_URL" \
bun run experts:import -- \
  --source backend/astraflow-api/migration/workbuddy/workbuddy-expert-center-downloaded-2026-07-07T15-30-46-670Z
```

也可以不用环境变量，直接传参：

```bash
node backend/astraflow-api/migration/0002_sync_workbuddy_expert_data.mjs \
  --source backend/astraflow-api/migration/workbuddy/workbuddy-expert-center-downloaded-2026-07-07T15-30-46-670Z \
  --database-url "$DATABASE_URL"
```

这个脚本是可重复跑的：会 upsert categories/experts，并替换每个 expert 的 agents、skills、mcp、team members 子表。正常预期大概是 `13 categories / 299 experts / 244 downloaded / 55 metadata_only`。
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
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0003_expert_list_sort_indexes.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0004_feedback.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0005_feedback_optional_session.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0006_feedback_messages_text.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0007_channel_management.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0008_click_analytics.up.sql
```

Rollback:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0008_click_analytics.down.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0007_channel_management.down.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0006_feedback_messages_text.down.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0005_feedback_optional_session.down.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0004_feedback.down.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0003_expert_list_sort_indexes.down.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0001_expert_system.down.sql
```

Do not commit production database credentials. Pass them through environment variables or the deployment platform secret manager.

Channel management requires two server-only secrets:

```bash
export ASTRAFLOW_ADMIN_API_KEY='replace-with-a-long-random-admin-key'
export ASTRAFLOW_CHANNEL_SECRET_KEY="$(openssl rand -base64 32)"
```

`ASTRAFLOW_ADMIN_API_KEY` protects `/v1/admin/*`. The 32-byte base64
`ASTRAFLOW_CHANNEL_SECRET_KEY` encrypts OAuth client secrets at rest and must be
kept stable across deployments. Rotating it requires re-saving every channel
secret through the admin console.

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

-- 統括の「バナー生成」。AIで作った画像をプロジェクトごとにまとめ、
-- 統括の登録メディアとして保存し、店舗（LINE公式アカウント）へ渡す。
--
-- 生成画像の実体は既存の media 表に置く（line_account_id は NULL＝統括所有）。
-- ここでは「どのプロジェクトの、どの生成条件で、何枚目か」だけを持つ。

CREATE TABLE IF NOT EXISTS banner_projects (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  is_favorite  INTEGER NOT NULL DEFAULT 0,
  archived_at  TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_banner_projects_tenant
  ON banner_projects(tenant_id, archived_at, updated_at DESC);

-- 生成のひとまとまり（ジョブ）。1回の「生成する」で1行。
-- 画像は1枚ずつ作るので、done_count が requested_count に達したら完了。
CREATE TABLE IF NOT EXISTS banner_generations (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id),
  project_id       TEXT NOT NULL REFERENCES banner_projects(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'running', 'done', 'failed', 'canceled')),
  mode             TEXT NOT NULL CHECK (mode IN ('banner', 'free')),
  preset_key       TEXT NOT NULL,
  aspect_ratio     TEXT NOT NULL,
  api_size         TEXT NOT NULL,
  quality          TEXT NOT NULL CHECK (quality IN ('low', 'medium', 'high')),
  text_lines       TEXT NOT NULL DEFAULT '[]',
  main_color       TEXT,
  sub_color        TEXT,
  person_option    TEXT NOT NULL DEFAULT 'without' CHECK (person_option IN ('with', 'without')),
  custom_prompt    TEXT NOT NULL DEFAULT '',
  free_prompt      TEXT NOT NULL DEFAULT '',
  final_prompt     TEXT NOT NULL,
  engine           TEXT NOT NULL DEFAULT 'openai',
  model_name       TEXT,
  requested_count  INTEGER NOT NULL DEFAULT 1,
  done_count       INTEGER NOT NULL DEFAULT 0,
  failed_count     INTEGER NOT NULL DEFAULT 0,
  units_per_image  INTEGER NOT NULL DEFAULT 1,
  error_message    TEXT,
  created_by       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  started_at       TEXT,
  finished_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_banner_generations_project
  ON banner_generations(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_banner_generations_tenant_status
  ON banner_generations(tenant_id, status);

-- 生成した（または統括が取り込んだ）画像。実体は media。
CREATE TABLE IF NOT EXISTS banner_images (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id),
  project_id       TEXT NOT NULL REFERENCES banner_projects(id) ON DELETE CASCADE,
  generation_id    TEXT REFERENCES banner_generations(id) ON DELETE SET NULL,
  media_id         TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  sequence         INTEGER NOT NULL DEFAULT 1,
  source           TEXT NOT NULL DEFAULT 'generated'
                     CHECK (source IN ('generated', 'upload', 'edited')),
  parent_image_id  TEXT,
  is_favorite      INTEGER NOT NULL DEFAULT 0,
  deleted_at       TEXT,
  created_by       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_banner_images_project
  ON banner_images(project_id, deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_banner_images_tenant
  ON banner_images(tenant_id, deleted_at, created_at DESC);

-- 店舗へ渡した記録。渡すたびに店舗側の media を1行作り、その対応を残す。
CREATE TABLE IF NOT EXISTS banner_image_deliveries (
  id               TEXT PRIMARY KEY,
  banner_image_id  TEXT NOT NULL REFERENCES banner_images(id) ON DELETE CASCADE,
  line_account_id  TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  media_id         TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  delivered_by     TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (banner_image_id, line_account_id)
);

-- 生成の利用量台帳。月ごとの上限判定と、失敗時の戻しに使う。
CREATE TABLE IF NOT EXISTS banner_usage_ledger (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  generation_id  TEXT,
  units          INTEGER NOT NULL,
  reason         TEXT NOT NULL CHECK (reason IN ('generate', 'refund', 'edit')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_banner_usage_tenant_created
  ON banner_usage_ledger(tenant_id, created_at);

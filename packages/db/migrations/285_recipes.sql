-- レシピと、レシピからの複製。設計 ★V6 34-2（`y0P0Qx`）/ 34-3（`D5UaX`）。台帳 #134。
--
-- **レシピは実行基盤を持たない静的な見本**（要件 v6-34 §7-1）。
-- 複製すると、対象アカウントに「ふつうの定義」が下書きで作られる。
-- 作られたものはレシピとつながらない。出どころだけを記録する。

CREATE TABLE IF NOT EXISTS recipes (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  purpose        TEXT NOT NULL,
  -- 作られるものの1行。設計 34-2 の「作られるもの：」に出す。
  creates_summary TEXT NOT NULL,
  -- 版。**複製したあとに新版を出しても、作られた定義は変わらない**（§7-4）。
  version        INTEGER NOT NULL DEFAULT 1,
  -- 初期同梱か、組織が作ったものか。
  origin         TEXT NOT NULL DEFAULT 'builtin' CHECK (origin IN ('builtin', 'org')),
  -- 必要な機能。機能設定の鍵の配列。切れない機能は入れない。
  required_features TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(required_features)),
  /*
    作られるものの内訳。**決まっていないものを埋めない。**
    決まっていなければ null にして、画面で「まだ決まっていません」と言う。
  */
  items_json     TEXT CHECK (items_json IS NULL OR json_valid(items_json)),
  -- 全部でいくつ作られるか。内訳が決まっていなくても数だけは分かる。
  item_count     INTEGER,
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

/*
  複製の実行。1回 = 1行。
  **途中失敗は全部戻す**（要件 §7-3）。部分的に作らない。
*/
CREATE TABLE IF NOT EXISTS recipe_clone_runs (
  id               TEXT PRIMARY KEY,
  recipe_id        TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  -- 複製したときのレシピの版。あとから新版が出ても、この値は変えない。
  recipe_version   INTEGER NOT NULL,
  line_account_id  TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  -- 名前のあたまに付ける文字。設計 34-3 の「2026春」。
  name_prefix      TEXT,
  status           TEXT NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running', 'succeeded', 'failed')),
  -- 冪等キー。同じキーで2回呼ばれても2回作らない。
  idempotency_key  TEXT NOT NULL,
  created_count    INTEGER NOT NULL DEFAULT 0,
  failure_reason   TEXT,
  created_by       TEXT,
  created_at       TEXT NOT NULL,
  finished_at      TEXT,
  UNIQUE (line_account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_recipe_clone_runs_recipe ON recipe_clone_runs (recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_clone_runs_account ON recipe_clone_runs (line_account_id);

/*
  複製で作られた定義。**どのレシピから作ったかは記録に残る**（設計 34-3）。
  作られたものの側にレシピへの参照は持たせない——つながらないため。
*/
CREATE TABLE IF NOT EXISTS recipe_clone_items (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES recipe_clone_runs(id) ON DELETE CASCADE,
  -- 何を作ったか。tag / friend_add_rule / scenario / template / reminder など。
  kind          TEXT NOT NULL,
  -- 作られた定義の ID。
  target_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recipe_clone_items_run ON recipe_clone_items (run_id);

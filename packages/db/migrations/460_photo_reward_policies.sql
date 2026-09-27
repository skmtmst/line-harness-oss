-- 460: 写真の報酬の決まりの版 (#817)。
-- 保存するたびに1行足す。前の版は変えない（追記だけ。UPDATE・DELETE しない）。
-- 「この版に戻す」はこの表の行を変えず、その中身で新しい版を作る。
-- 使い始めの日時 (effective_from) を版ごとに持てる。空なら公開と同時。
-- 採用した時点の版を、付与の記録 (nen_photo_reward_outbox) に写しとして持つ。
-- 版を変えても、過去の付与は変わらない。
CREATE TABLE IF NOT EXISTS photo_reward_policies (
  id TEXT PRIMARY KEY,
  version_number INTEGER NOT NULL UNIQUE,
  -- 付与の記録に写す鍵。第1版は既存の 'legacy-5' と同じ鍵にする。
  -- 第2版からは 'v2' 'v3' …と付ける。
  policy_key TEXT NOT NULL UNIQUE,
  -- 採用1枚につき付けるポイント数。
  points INTEGER NOT NULL CHECK (points > 0 AND points <= 100000),
  -- 版の中身のひとこと。「報酬を5pt→10ptに」など。
  summary TEXT NOT NULL DEFAULT '',
  -- 使い始めの日時。空は「公開と同時」。未来の日時は「予約」の札で見せる。
  effective_from TEXT,
  created_by_staff_id TEXT,
  -- 同じ確認キーの再送では版を増やさないための鍵。
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_photo_reward_policies_version
  ON photo_reward_policies (version_number DESC);

-- 既存の採用は5pt固定だった。その決まりを第1版として残す。
-- 黙って付け直さない。新しい採用から、その時点で使っている版を見る。
INSERT OR IGNORE INTO photo_reward_policies
  (id, version_number, policy_key, points, summary, effective_from, created_at)
VALUES
  (lower(hex(randomblob(16))), 1, 'legacy-5', 5, '最初の報酬の決まり', NULL, datetime('now'));

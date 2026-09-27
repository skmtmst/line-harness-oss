-- W: 裏の仕組みの読み書き試し（v6-32 §5-3）で使う使い捨ての行。
-- 確認のたびに「書く・読む・消す」をこの表へ行い、D1が本当に動いているかを
-- 実測する。残っても無害な行なので、古いものは確認時にまとめて消す。
CREATE TABLE IF NOT EXISTS operation_infra_probes (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('d1')),
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

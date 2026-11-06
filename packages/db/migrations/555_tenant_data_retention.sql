-- 統括(テナント)の顧客データ保存期限を管理する3列を追記する。
-- retention_anchor_at: 保存期限を数え始める時刻。解約の反映時、または無料体験の終了を検出した時に一度だけ入れる。
--                      一度入ったら後の課金更新では上書きしない(再契約時に明示的に空へ戻す場合を除く)。
-- purge_requested_at:  利用者から早期削除の要請を受けた時刻。入っていれば90日を待たずに削除対象にする。
-- data_purged_at:      顧客データの削除が完了した時刻。入っている統括は再度の削除対象にしない。
ALTER TABLE tenants ADD COLUMN retention_anchor_at TEXT;
ALTER TABLE tenants ADD COLUMN purge_requested_at TEXT;
ALTER TABLE tenants ADD COLUMN data_purged_at TEXT;

-- 6時間毎のcronが「削除がまだ終わっていない保存起点つきの統括」だけを拾えるようにする。
CREATE INDEX IF NOT EXISTS idx_tenants_retention_pending
  ON tenants (retention_anchor_at)
  WHERE data_purged_at IS NULL;

-- 削除の実績を残す監査表。顧客データを消した後に「いつ・何件消したか」を示せるようにする。
-- この表自体は顧客データではないので削除対象に入れない。
CREATE TABLE IF NOT EXISTS tenant_data_purge_audit (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  -- immediate: 早期削除の要請による削除 / expired: 保存期限の満了による削除
  reason TEXT NOT NULL,
  -- 保存起点。どの時点から数えて期限が切れたのかを後から確かめられるようにする。
  retention_anchor_at TEXT,
  started_at TEXT NOT NULL,
  -- 全ての表を消し終えた回だけ入る。途中で上限に達した回は空のままにする。
  finished_at TEXT,
  -- この回に消した行数の合計と、表ごとの内訳 {"friends": 12, ...}
  deleted_rows INTEGER NOT NULL DEFAULT 0,
  deleted_rows_by_table TEXT NOT NULL DEFAULT '{}',
  -- この回に消した画像(R2)の数
  deleted_objects INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tenant_data_purge_audit_tenant
  ON tenant_data_purge_audit (tenant_id, created_at DESC);

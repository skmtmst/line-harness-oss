-- 配布元と店での変更は予約メニューと同じ方法で保持する。
ALTER TABLE mileage_rewards ADD COLUMN hq_template_id TEXT;
ALTER TABLE mileage_rewards ADD COLUMN hq_template_version_id TEXT;
ALTER TABLE mileage_rewards ADD COLUMN hq_customized INTEGER NOT NULL DEFAULT 0 CHECK (hq_customized IN (0, 1));
-- 配布元の保管後も、以前の交換を在庫から引き続き数える。
ALTER TABLE mileage_rewards ADD COLUMN hq_stock_cumulative INTEGER NOT NULL DEFAULT 0 CHECK (hq_stock_cumulative IN (0, 1));

CREATE TRIGGER mileage_reward_hq_origin_insert BEFORE INSERT ON mileage_rewards
WHEN NEW.hq_template_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM hq_templates t JOIN hq_template_versions v ON v.template_id=t.id AND v.tenant_id=t.tenant_id
  JOIN line_accounts a ON a.tenant_id=t.tenant_id
  WHERE t.id=NEW.hq_template_id AND v.id=NEW.hq_template_version_id AND a.id=NEW.line_account_id AND t.catalog_type='mileage_reward'
)
BEGIN SELECT RAISE(ABORT,'hq_origin_account_mismatch'); END;

CREATE TRIGGER mileage_reward_hq_origin_update BEFORE UPDATE OF hq_template_id,hq_template_version_id,line_account_id ON mileage_rewards
WHEN NEW.hq_template_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM hq_templates t JOIN hq_template_versions v ON v.template_id=t.id AND v.tenant_id=t.tenant_id
  JOIN line_accounts a ON a.tenant_id=t.tenant_id
  WHERE t.id=NEW.hq_template_id AND v.id=NEW.hq_template_version_id AND a.id=NEW.line_account_id AND t.catalog_type='mileage_reward'
)
BEGIN SELECT RAISE(ABORT,'hq_origin_account_mismatch'); END;

CREATE TRIGGER mileage_reward_hq_local_edit AFTER UPDATE OF name,description,image_url,reward_kind,current_draft_version_id ON mileage_rewards
WHEN OLD.hq_template_id IS NOT NULL AND NEW.hq_template_version_id IS OLD.hq_template_version_id
AND (OLD.name IS NOT NEW.name OR OLD.description IS NOT NEW.description OR OLD.image_url IS NOT NEW.image_url OR OLD.reward_kind IS NOT NEW.reward_kind OR OLD.current_draft_version_id IS NOT NEW.current_draft_version_id)
BEGIN UPDATE mileage_rewards SET hq_customized=1 WHERE id=NEW.id; END;

CREATE TRIGGER mileage_reward_hq_local_version_edit AFTER UPDATE OF required_miles,stock_limit,per_friend_limit,starts_at,ends_at,benefit_expires_days,common_action_version_id,failure_policy,customer_message,target_conditions ON mileage_reward_versions
WHEN OLD.required_miles IS NOT NEW.required_miles OR OLD.stock_limit IS NOT NEW.stock_limit OR OLD.per_friend_limit IS NOT NEW.per_friend_limit
  OR OLD.starts_at IS NOT NEW.starts_at OR OLD.ends_at IS NOT NEW.ends_at OR OLD.benefit_expires_days IS NOT NEW.benefit_expires_days
  OR OLD.common_action_version_id IS NOT NEW.common_action_version_id OR OLD.failure_policy IS NOT NEW.failure_policy
  OR OLD.customer_message IS NOT NEW.customer_message OR OLD.target_conditions IS NOT NEW.target_conditions
BEGIN UPDATE mileage_rewards SET hq_customized=1 WHERE id=NEW.reward_id AND hq_template_id IS NOT NULL; END;

CREATE TRIGGER mileage_reward_hq_local_version_insert AFTER INSERT ON mileage_reward_versions
BEGIN UPDATE mileage_rewards SET hq_customized=1 WHERE id=NEW.reward_id AND hq_template_id IS NOT NULL; END;

CREATE TRIGGER mileage_reward_hq_archive_origin AFTER UPDATE OF archived_at ON hq_templates WHEN NEW.archived_at IS NOT NULL
BEGIN UPDATE mileage_rewards SET hq_template_id=NULL,hq_template_version_id=NULL,hq_customized=0
  WHERE hq_template_id=NEW.id AND line_account_id IN (SELECT id FROM line_accounts WHERE tenant_id=NEW.tenant_id); END;

-- 判断は対象と配布された版ごとに残す。対象を削除した場合は、その店の履歴も削除する。
CREATE TABLE hq_catalog_update_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  template_id TEXT NOT NULL,
  template_version_id TEXT NOT NULL,
  menu_id TEXT REFERENCES menus(id) ON DELETE CASCADE,
  reward_id TEXT REFERENCES mileage_rewards(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('pending','adopted','kept')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_at TEXT,
  FOREIGN KEY (template_id,tenant_id) REFERENCES hq_templates(id,tenant_id),
  FOREIGN KEY (template_version_id,template_id,tenant_id) REFERENCES hq_template_versions(id,template_id,tenant_id),
  CHECK ((menu_id IS NOT NULL) <> (reward_id IS NOT NULL)),
  CHECK ((decision='pending' AND decided_at IS NULL) OR (decision<>'pending' AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX hq_catalog_decision_menu_version ON hq_catalog_update_decisions(menu_id,template_version_id) WHERE menu_id IS NOT NULL;
CREATE UNIQUE INDEX hq_catalog_decision_reward_version ON hq_catalog_update_decisions(reward_id,template_version_id) WHERE reward_id IS NOT NULL;
CREATE INDEX hq_catalog_decisions_account ON hq_catalog_update_decisions(line_account_id,decision);

CREATE TRIGGER hq_catalog_decision_scope_insert BEFORE INSERT ON hq_catalog_update_decisions
WHEN NOT EXISTS (
  SELECT 1 FROM hq_templates t JOIN hq_template_versions v ON v.template_id=t.id AND v.tenant_id=t.tenant_id
  JOIN line_accounts a ON a.tenant_id=t.tenant_id
  WHERE t.id=NEW.template_id AND t.tenant_id=NEW.tenant_id AND v.id=NEW.template_version_id AND a.id=NEW.line_account_id
  AND ((NEW.menu_id IS NOT NULL AND t.catalog_type='booking_menu' AND EXISTS (SELECT 1 FROM menus m WHERE m.id=NEW.menu_id AND m.line_account_id=a.id AND m.hq_template_id=t.id))
    OR (NEW.reward_id IS NOT NULL AND t.catalog_type='mileage_reward' AND EXISTS (SELECT 1 FROM mileage_rewards r WHERE r.id=NEW.reward_id AND r.line_account_id=a.id AND r.hq_template_id=t.id)))
)
BEGIN SELECT RAISE(ABORT,'hq_origin_account_mismatch'); END;

CREATE TRIGGER hq_catalog_decision_identity_immutable BEFORE UPDATE OF tenant_id,line_account_id,template_id,template_version_id,menu_id,reward_id ON hq_catalog_update_decisions
BEGIN SELECT RAISE(ABORT,'hq_catalog_decision_identity_immutable'); END;

CREATE TRIGGER hq_catalog_decision_final_immutable BEFORE UPDATE OF decision,decided_at ON hq_catalog_update_decisions
WHEN OLD.decision <> 'pending' AND (OLD.decision IS NOT NEW.decision OR OLD.decided_at IS NOT NEW.decided_at)
BEGIN SELECT RAISE(ABORT,'hq_catalog_decision_final_immutable'); END;

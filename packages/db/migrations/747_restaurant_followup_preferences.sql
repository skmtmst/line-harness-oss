-- 店ごとの「今は使わない」を明示的に保存する。未保存は未確認として扱う。
CREATE TABLE rt_store_followup_preferences (
 store_id TEXT PRIMARY KEY REFERENCES rt_stores(id),
 not_using INTEGER NOT NULL DEFAULT 0 CHECK(not_using IN(0,1)),
 decided_at TEXT,
 decided_by TEXT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1)
);
-- 有効な送り方ができたら、初期設定を見送った判断を同じ取引の中で解除する。
CREATE TRIGGER rt_followup_preference_binding_inserted AFTER INSERT ON rt_store_followup_step_bindings WHEN NEW.enabled=1
 BEGIN UPDATE rt_store_followup_preferences SET not_using=0,decided_at=NULL,decided_by=NULL,version=version+1 WHERE store_id=NEW.store_id AND not_using=1; END;
CREATE TRIGGER rt_followup_preference_binding_enabled AFTER UPDATE OF enabled ON rt_store_followup_step_bindings WHEN NEW.enabled=1
 BEGIN UPDATE rt_store_followup_preferences SET not_using=0,decided_at=NULL,decided_by=NULL,version=version+1 WHERE store_id=NEW.store_id AND not_using=1; END;
CREATE TRIGGER rt_followup_preference_target_inserted AFTER INSERT ON rt_store_followup_targets WHEN NEW.enabled=1
 BEGIN UPDATE rt_store_followup_preferences SET not_using=0,decided_at=NULL,decided_by=NULL,version=version+1 WHERE store_id=NEW.store_id AND not_using=1; END;
CREATE TRIGGER rt_followup_preference_target_enabled AFTER UPDATE OF enabled ON rt_store_followup_targets WHEN NEW.enabled=1
 BEGIN UPDATE rt_store_followup_preferences SET not_using=0,decided_at=NULL,decided_by=NULL,version=version+1 WHERE store_id=NEW.store_id AND not_using=1; END;

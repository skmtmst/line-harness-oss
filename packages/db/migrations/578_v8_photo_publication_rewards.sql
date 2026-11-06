-- V8: 掲載順と掲載時の追加報酬。検証・本番適用はオーナー承認待ち。
ALTER TABLE nen_photo_publications ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nen_photo_publications ADD COLUMN reward_policy_key TEXT;
ALTER TABLE nen_photo_publications ADD COLUMN reward_points INTEGER CHECK (reward_points BETWEEN 0 AND 100000);
ALTER TABLE photo_reward_policies ADD COLUMN publication_points INTEGER NOT NULL DEFAULT 0 CHECK (publication_points BETWEEN 0 AND 100000);
CREATE TABLE nen_photo_publication_reward_outbox (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL UNIQUE REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  provider_award_key TEXT NOT NULL UNIQUE,
  policy_version TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points > 0),
  status TEXT NOT NULL CHECK (status IN ('pending','processing','synced','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_photo_publication_reward_due ON nen_photo_publication_reward_outbox(status,next_attempt_at);

-- 使い始めに時差のない旧データは日本時間として扱う。
-- 初回掲載の版を0点の場合も固定する。移行前の掲載には版を足さず、遡及付与しない。
CREATE TRIGGER v8_photo_publication_policy_insert AFTER INSERT ON nen_photo_publications
BEGIN UPDATE nen_photo_publications SET reward_policy_key=COALESCE((SELECT policy_key FROM photo_reward_policies WHERE effective_from IS NULL OR julianday(effective_from,CASE WHEN substr(effective_from,11) GLOB '*[Zz+-]*' THEN '+0 hours' ELSE '-9 hours' END)<=julianday('now') ORDER BY version_number DESC LIMIT 1),'legacy-5'), reward_points=COALESCE((SELECT publication_points FROM photo_reward_policies WHERE effective_from IS NULL OR julianday(effective_from,CASE WHEN substr(effective_from,11) GLOB '*[Zz+-]*' THEN '+0 hours' ELSE '-9 hours' END)<=julianday('now') ORDER BY version_number DESC LIMIT 1),0) WHERE id=NEW.id; END;

-- 掲載・採用の状態変更と報酬予約は同じトランザクション。写真ごとに一度だけ。
CREATE TRIGGER v8_photo_publication_reward_snapshot AFTER UPDATE OF reward_points ON nen_photo_publications
BEGIN INSERT INTO nen_photo_publication_reward_outbox (id,photo_id,line_account_id,friend_id,customer_id,provider_award_key,policy_version,points,status,last_error,created_at,updated_at) SELECT 'photo-publication-reward:' || ps.id,ps.id,ps.line_account_id,ps.friend_id,COALESCE(member.customer_id,''), 'photo-publication-reward:' || ps.id,pub.reward_policy_key,pub.reward_points, CASE WHEN member.customer_id IS NOT NULL AND member.customer_id != '' THEN 'pending' ELSE 'failed' END, CASE WHEN member.customer_id IS NOT NULL AND member.customer_id != '' THEN NULL ELSE 'customer_unlinked' END, (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours') || '+09:00'),(strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours') || '+09:00') FROM nen_photo_submissions ps JOIN nen_photo_publications pub ON pub.photo_id=ps.id AND pub.line_account_id=ps.line_account_id AND pub.status='published' JOIN friends f ON f.id=ps.friend_id AND f.line_account_id=ps.line_account_id LEFT JOIN nen_ec_member_snapshots member ON member.friend_id=ps.friend_id WHERE pub.id=NEW.id AND ps.status='adopted' AND ps.publication_consent_at IS NOT NULL AND ps.publication_withdrawn_at IS NULL AND pub.reward_policy_key IS NOT NULL AND pub.reward_points>0 ON CONFLICT DO NOTHING; END;

-- 掲載・採用の状態変更と報酬予約は同じトランザクション。写真ごとに一度だけ。
CREATE TRIGGER v8_photo_publication_reward_restore AFTER UPDATE OF status ON nen_photo_publications WHEN NEW.status='published' AND OLD.status<>'published'
BEGIN INSERT INTO nen_photo_publication_reward_outbox (id,photo_id,line_account_id,friend_id,customer_id,provider_award_key,policy_version,points,status,last_error,created_at,updated_at) SELECT 'photo-publication-reward:' || ps.id,ps.id,ps.line_account_id,ps.friend_id,COALESCE(member.customer_id,''), 'photo-publication-reward:' || ps.id,pub.reward_policy_key,pub.reward_points, CASE WHEN member.customer_id IS NOT NULL AND member.customer_id != '' THEN 'pending' ELSE 'failed' END, CASE WHEN member.customer_id IS NOT NULL AND member.customer_id != '' THEN NULL ELSE 'customer_unlinked' END, (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours') || '+09:00'),(strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours') || '+09:00') FROM nen_photo_submissions ps JOIN nen_photo_publications pub ON pub.photo_id=ps.id AND pub.line_account_id=ps.line_account_id AND pub.status='published' JOIN friends f ON f.id=ps.friend_id AND f.line_account_id=ps.line_account_id LEFT JOIN nen_ec_member_snapshots member ON member.friend_id=ps.friend_id WHERE pub.id=NEW.id AND ps.status='adopted' AND ps.publication_consent_at IS NOT NULL AND ps.publication_withdrawn_at IS NULL AND pub.reward_policy_key IS NOT NULL AND pub.reward_points>0 ON CONFLICT DO NOTHING; END;

-- 掲載・採用の状態変更と報酬予約は同じトランザクション。写真ごとに一度だけ。
CREATE TRIGGER v8_photo_publication_reward_adopt AFTER UPDATE OF status ON nen_photo_submissions WHEN NEW.status='adopted' AND OLD.status<>'adopted'
BEGIN INSERT INTO nen_photo_publication_reward_outbox (id,photo_id,line_account_id,friend_id,customer_id,provider_award_key,policy_version,points,status,last_error,created_at,updated_at) SELECT 'photo-publication-reward:' || ps.id,ps.id,ps.line_account_id,ps.friend_id,COALESCE(member.customer_id,''), 'photo-publication-reward:' || ps.id,pub.reward_policy_key,pub.reward_points, CASE WHEN member.customer_id IS NOT NULL AND member.customer_id != '' THEN 'pending' ELSE 'failed' END, CASE WHEN member.customer_id IS NOT NULL AND member.customer_id != '' THEN NULL ELSE 'customer_unlinked' END, (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours') || '+09:00'),(strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours') || '+09:00') FROM nen_photo_submissions ps JOIN nen_photo_publications pub ON pub.photo_id=ps.id AND pub.line_account_id=ps.line_account_id AND pub.status='published' JOIN friends f ON f.id=ps.friend_id AND f.line_account_id=ps.line_account_id LEFT JOIN nen_ec_member_snapshots member ON member.friend_id=ps.friend_id WHERE ps.id=NEW.id AND ps.status='adopted' AND ps.publication_consent_at IS NOT NULL AND ps.publication_withdrawn_at IS NULL AND pub.reward_policy_key IS NOT NULL AND pub.reward_points>0 ON CONFLICT DO NOTHING; END;

-- #1000 DETAIL-11: 予約枠の一括追加の再送防止キー。
--
-- 401件の一括追加は画面側で400+1に分割して送る。後半が失敗したあと
-- もう一度送ると、成功済みの400件も新IDで二重登録されていた。
-- 画面が発行する client_key を枠ごとに保存し、(event_id, client_key) の
-- 一意性で同じ枠の再登録を吸収する。日時の一意制約ではないので、
-- 正当な同時開催(同じ日時の別枠)はこれまでどおり作れる。
-- client_key を持たない既存行・単発追加は NULL のまま残る。

ALTER TABLE event_slots ADD COLUMN client_key TEXT;

-- 一意にするのは「生きている枠」だけ。論理削除された枠は索引から外れ、
-- 削除後に同じキーで作り直せる(サーバー側の再利用照合も
-- deleted_at IS NULL で絞るので、この条件と一致させる)。
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_slots_client_key
  ON event_slots (event_id, client_key)
  WHERE client_key IS NOT NULL AND deleted_at IS NULL;

-- scenario_steps に message_bubbles_json を足す。
--
-- bootstrap.sql はこの列を持っているが、どのマイグレーションも足していない。
-- 087 が足したのは broadcasts 側だけで、scenario_steps 側は
-- bootstrap.sql の生成元になった開発環境にだけ存在していた。
--
-- そのままだと、環境によって形が違う状態が続く。
--
--   新規インストール（bootstrap.sql から） … 列が有る
--   既存環境（マイグレーションを積んだ）   … 列が無い
--
-- いまはこの列を読むコードが無いので実害は出ていない。
-- ただしステップ配信を複数吹き出しに対応させた時点で、
-- 「新規では動くが既存では落ちる」という形で表に出る。
-- 出てから探すより、形を揃えておくほうがよい。
--
-- broadcasts 側（087）と同じ定義にする。
ALTER TABLE scenario_steps ADD COLUMN message_bubbles_json TEXT
  CHECK (message_bubbles_json IS NULL OR json_valid(message_bubbles_json));

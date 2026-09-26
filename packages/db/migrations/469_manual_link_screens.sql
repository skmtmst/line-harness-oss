-- 画面ごとのマニュアル導線（#842 G-8）。
--
-- 286 で作った正本表へ、トップバーに出る画面のID行をまとめて入れる。
-- キーは `apps/web/src/lib/manual-screen-key.ts` の対応表と同じ
-- `x-y` 番号。URLは入れない（'unset'）——登録・確かめるのは運営が
-- `/settings/manual-links` で行う。

INSERT OR IGNORE INTO manual_links (key, key_kind, name, url, status, updated_at) VALUES
  ('3-1',  'screen', '友だち',                   NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('4-2',  'screen', '友だち情報欄',             NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('6-1',  'screen', '一斉配信',                 NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('7-1',  'screen', 'リマインダ',               NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('8-1',  'screen', '自動応答',                 NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('10-1', 'screen', 'ウェビナー',               NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('11-1', 'screen', 'テンプレート',             NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('12-1', 'screen', 'リッチメニュー',           NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('13-1', 'screen', '回答フォーム',             NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('14-1', 'screen', '共通情報',                 NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('15-1', 'screen', '登録メディア',             NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('16-1', 'screen', 'アフィリエイト',           NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('17-1', 'screen', 'マイル',                   NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('18-1', 'screen', '流入リンク',               NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('19-1', 'screen', '成果地点',                 NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('21-1', 'screen', 'NEN配信の中身を編集',      NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('23-1', 'screen', 'EC連携',                   NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('25-1', 'screen', 'オートメーション',         NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('26-1', 'screen', '外部連携',                 NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('27-1', 'screen', '予約管理',                 NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('28-1', 'screen', '予約設定',                 NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('29-1', 'screen', 'イベント',                 NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('30-1', 'screen', 'ログインユーザー',         NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('31-1', 'screen', '機能設定',                 NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('33-2', 'screen', 'LINEアカウントを登録',     NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('36-2', 'screen', '課金プラン',               NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('36-5', 'screen', '統括 メンバー管理',        NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('36-7', 'screen', '統括 アカウント管理',      NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('37-5', 'screen', 'NENメンバー',              NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('37-6', 'screen', 'NEN配信',                  NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('37-11','screen', '運営・ナレッジ一覧',       NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'));

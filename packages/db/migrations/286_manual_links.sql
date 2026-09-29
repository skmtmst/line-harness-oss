-- マニュアルの正本表。設計 ★V6 34-4（`f9oUm`）。台帳 #134。
--
-- トップバーの「マニュアル」がどこを開くかを、運営だけが決める表。
-- **お客さまの組織ごとには変えない**（要件 v6-34 §8-2）。

CREATE TABLE IF NOT EXISTS manual_links (
  -- 画面ID（`2-1` など）か、作業ID（`createOfficialAccount` など）。
  -- 要件 §8-2「正本表に『作業 ID』の列を足して吸収する」。
  key           TEXT PRIMARY KEY,
  /*
    どちらの ID か。
      screen … 画面ID。トップバーの「マニュアル」が引く
      task   … 作業ID。はじめの設定や店舗登録の案内リンクが引く
  */
  key_kind      TEXT NOT NULL CHECK (key_kind IN ('screen', 'task')),
  name          TEXT NOT NULL,
  -- 公式記事の URL。まだ決めていなければ null。**空文字を入れない。**
  url           TEXT,
  /*
    リンクの状態。
      ok     … 開ける（確かめた）
      broken … 開けない
      unset  … まだ決めていない
    **確かめていない URL を ok にしない。** 確かめて初めて言える。
  */
  status        TEXT NOT NULL DEFAULT 'unset' CHECK (status IN ('ok', 'broken', 'unset')),
  last_checked_at TEXT,
  -- 開けなかったときの手がかり（HTTP の状態など）。
  last_error    TEXT,
  updated_by    TEXT,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_manual_links_status ON manual_links (status);

-- いま手元にある作業ID 4件。URL は決まり次第、運営が入れる。
INSERT OR IGNORE INTO manual_links (key, key_kind, name, url, status, updated_at) VALUES
  ('createOfficialAccount', 'task', 'LINE公式アカウントを作る', NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('enableMessagingApi',    'task', 'Messaging APIを有効にする', NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('findChannelCredentials','task', '2つの値の場所を見る',      NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('createLiffApp',         'task', 'LIFFアプリを作る',          NULL, 'unset', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'));

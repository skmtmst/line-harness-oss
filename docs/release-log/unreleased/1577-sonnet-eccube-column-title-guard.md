## 修正

- EC-Cube連携のWebhook（`POST /api/integrations/eccube/columns`）の記事タイトルにサーバ側の長さ検証が無く、コラム紹介文（`intro_text`）が1500字で記録も残さず黙って切り詰められていたのを、管理画面と同じ120字上限を入口に課し（超過時は`title_invalid`で400・構造化ログ）、出口の`buildDefaultColumnIntro`にも#659と同じ考え方の切り詰め記録を追加して止めた @sonnet #1577 #711 2026-09-11 04:09

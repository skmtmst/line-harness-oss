## 修正

- 友だちタイムライン（GET /api/friends/:id/timeline）の問い合わせが8項のcompound SELECTでD1のSQLITE_MAX_COMPOUND_SELECT（既定5）を超えて構文エラーになり検証環境で動いていなかったのを、4項ずつのCTEへ割って直した @sonnet #1585 #717 2026-09-11 07:31

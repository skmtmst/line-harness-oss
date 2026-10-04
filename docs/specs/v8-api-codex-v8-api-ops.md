# V8 設定・通知・EC・流入 API（2026-10-04）

正本：design/v8/html の FDBsG・Q5le3・D0AOyx・xuJ7D・gjUz3・ihjfd・w1W8h・SyQA1。基準 SHA：22cf0869f2d62dccd18f606a25ec314927de7fe5。ローカル実装のみ。push・PR・CI・外部DB適用・Slack投稿なし。

| 板 | 入力・API | 出力・完了条件 | 権限・失敗時 |
|---|---|---|---|
| FDBsG | GET /api/ad-platforms/mappings?account_id、PUT /api/ad-platforms/mappings/:pointId。媒体ごとに mode=auto/manual/off、eventName、expectedVersion | 成果地点ごとの自動対応と手動上書き。自動は購入→Purchase（Google=purchase）、定期→Subscribe（Google=subscribe）、予約→Schedule（Google=schedule）。未対応は送らない。成果発生時に対応を解決し、既存の冪等送信台帳へ渡す | 閲覧はアカウント範囲内、変更はowner/admin。入力不正422、範囲外404、競合409。秘密値・顧客情報を返さない |
| Q5le3 | GET /api/entry-routes/:id/funnel（既存拡張） | first touchの友だちだけ、残人数・ブロック数・成果金額・1人あたり金額。月別内訳は追加月別の人数とその人たちの現在の状態・成果。全件集計でページに依存しない。分母0の金額はnull | 既存の経路閲覧権限・範囲を維持。取得失敗500、未取得を0表示しない |
| D0AOyx | POST /api/traffic-pools {slug,name,activeAccountId,accountIds?}。旧1件入力も対応 | 全所属をD1 batchで原子的に登録。受け入れ先は稼働中の所属からランダム | owner限定。全所属の範囲と有効性確認。不正422、権限403、slug重複409。部分作成しない |
| xuJ7D | GET /api/getting-started（既存拡張） | V8用6段：接続→初期セット→分類→追加時配信→シナリオ→実送達。初期セットは選択アカウントの保存済み機能設定があること。送達判定は既存の実送達判定を継続。表示だけで完了にしない | owner/admin/staff、各段の操作権限を確認。範囲外404、失敗500。V7は従来5段を表示 |
| gjUz3 | GET/POST /api/notifications/teams、PUT/DELETE /api/notifications/teams/:id {accountId,name,staffIds,expectedVersion}。通知のconditionsにteamId | チームを作成・選択・編集・退避。通知時に現在の所属を解決。公開時0人は不可。退避チームを新規公開に使わない | owner/adminの範囲内。所属スタッフ全員のアカウント範囲を確認。不正422、範囲外404、競合409 |
| ihjfd | PUT /api/line-accounts/:id {timezone} | IANAタイムゾーンを保存・再取得。資格情報・既存予約時刻は変更しない | owner限定。不正422、範囲外404、退避済409。V8詳細の編集から保存 |
| w1W8h | GET /api/ec-commerce/operations/identity-candidates（既存拡張） | pending候補全体の見込み売上。複数LINE候補が同じEC会員を指す場合は1会員につき1回。件と人は差引きしない。未候補会員数も独立集計 | 既存tenant/account scopeを維持。未知の金額null、失敗500 |
| SyQA1 | POST /api/integrations/eccube/events、ec.site.publication_viewed の publication_views にview_date=YYYY-MM-DD（UTC日付）、view_count=その日累計を追加 | 日別最大値を保存し、UTCの今日を含む30日を集計。再送・逆順でも重複しない。view_dateなしは既存の生涯累計のみ（30日へ混ぜない）。未計測はnull。掲載一覧と最多閲覧も30日値 | 既存HMAC署名・アカウント範囲・停止設定を維持。入力不正400、秘密値不要。受信失敗503は同じevent_idで再試行可能 |

DB変更予定：573 広告対応、574 通知チーム、575 掲載の日別閲覧。すべて採番内、未適用。新表は保存期間台帳へ分類する。各機能ごとWorker・DB・画面試験、各tsc、差分検査後コミット。履歴は codex-v8-api-ops-codex.md。

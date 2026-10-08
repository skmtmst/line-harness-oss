# 監査4本目の引き継ぎ（2026-10-08）

開始時の基準: `origin/codex/development` = `b71ac2b0d1aa21180c2f1c422601e75f01c6db77`。
作業枝: `codex/codex-audit-fix4-10081719`。
開始診断は `DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` で合格。
開始時の作業ツリーはクリーン。push・PR・DB適用・配備は行っていない。

確認資料: `/Volumes/My Passport/Codex-audit/full-repo-audit-20261008/claude-v8-migration-handoff-20261008.md` と `parent-validation.json`。
W23の対象は、資料が指す共通のオートメーション実行エンジン。
仕様の判断は、この依頼に記された2026-10-08のオーナー決定を採用した。

## 修正したもの

| 対象 | コミット | 内容と試験 |
| --- | --- | --- |
| W6 | `ea00d311a4` | 再試行で元のURLがnullになる試験を先に落とした。pendingは元のprovider・決済ID・重複防止キーから既存画面だけを取得する。担当者用・LIFF用の10試験、Worker型検査が合格。 |
| W23 | `2124f43ade` | タグ変更後に待機も飛ばされる2試験を先に落とした。子処理は親の保存済みmatchedだけを使う。新計画は親の通IDを持ち、旧計画はパスと条件から親を特定する。記録が不明なら条件を再評価せず失敗にする。旧計画・待機・入れ子を含む26試験、Worker型検査が合格。 |
| PKG06/07 | `fa8ea3a65d` | 比較基準・入金額・店舗曜日の5試験を先に落とした。売上は今期も前期も料金×確定数。入金は別集計。日本・ニューヨーク・UTCの曜日、決済設定停止後の過去入金、返金除外を含む13試験が合格。Worker・DB・共有型・Webの型検査が合格。 |

W6の本物の決済設定は変更していない。既存Stripe試験providerは決済IDを検証して元のURLを復元する。
差し替えproviderは新しい任意メソッド `getCheckoutUrl` で既存画面を取得する必要がある。
取得できないproviderでは新しい支払いを作らず409を返す。将来、本物のproviderを入れる際はサービス側からの既存画面取得、またはURL保存用DB変更を別途承認する。

予約売上の `revenue` は予約開始日時の期間で、`paidRevenue` は支払い済みかつ返金されていない支払いの `paid_at` の期間で集計する。
入金のメニュー・曜日への振り分けは、その入金に紐づく予約のメニュー・店舗時刻の予約開始曜日を使う。
既存の期間入力（YYYY-MM-DD → UTC境界）は変更していない。今回の店舗時刻対応は曜日集計。
オフセットなしの旧予約日時は店舗の壁時計として曜日を数える。設定なしの店舗はAsia/Tokyo。

## DB変更が必要なため実装していないもの

### W45: 質問回答の未完工程を管理者が再開するAPI

実SQLiteでタグ追加をわざと失敗させた。受信ログは残り、障害を取り除いて押し直してもrepeatになり、タグは0件のまま。
「タグ処理が完了するはず」の再現試験は0≠1で落ちた。自動再試行や受信ログの削除は実装していない。

現行の `messages_log` は受信事実、アクションのfiresは一部アクションの実行済み印であり、選択肢に直接付くタグ・友だち情報・シナリオ操作を含む工程別完了記録ではない。
これらを流用して全部を再実行すると、成功済みの操作も繰り返すため、専用の回答実行・工程台帳が必要。

承認が必要な保存内容:

- アカウント、友だち、固定公開版の質問、最初に選んだ選択肢の写し、安定した回答実行ID。single/multipleの重複判定を維持。
- 工程別の実行ID・結果・失敗・実行権の期限・試行番号。成功済みは再開で増やさない。
- 管理者の再開理由・実行者・日時。返信済みの返事や消費済みreplyTokenを再送しない。
- 古い受信ログだけの回答は成功/未完を推定しない。「不明」として照合してから回復する。

承認後に作る口の案は `POST /api/scenarios/:scenarioId/question-answers/:answerExecutionId/resume` と未完一覧のGET。
これは未実装。owner/admin、可視アカウント、友だち本人の所属、版、期限、同アカウント資源の条件を維持し、自動では再開しない。
採番・SQLファイル・APIの空実装は作っていない。

### WEB206: バナーのサーバー継続

生成受付を1回だけ呼び、画面からの後続呼び出しを行わない再現試験で、バックグラウンド処理は0件、生成はqueued・0枚のままだった。
「サーバーだけで2枚完成するはず」の試験は落ちた。実際の画像サービスや有料処理は呼んでいない。
現行の `/run` は1枚ずつで、次の1枚を開始する主体は画面のループ。cron/queue側のバナー実行主体はない。

D1の永続ジョブとして安全に実装するには、次の追加が必要:

- 実行担当・実行権の期限・生成1枚ごとの安定ID/状態/保存完了の記録。ブラウザのループとサーバーが同じ画像を二重生成しない。
- 切り抜き位置等の実行入力。現行gravityは各 `/run` の要求だけにあり、保存されていない。
- 停止要求の保存と、生成・画像保存・件数更新の競合対策。停止を後続の成功更新で上書きしない。
- 永続キューの実行主体。HTTPのwaitUntilだけを継続の保証にしない。

既存のgeneration表には実行担当・実行権・停止要求・1枚単位の工程記録がなく、D1追加を伴うため今回作っていない。
W99/W100と同じ `hq-banners.ts` の実行・確定処理に関係する。2本目・3本目の当該担当の有無は司令塔で確定してから着手する。
既存cancel APIはあるが、走行中のrunが後でstatusを更新するため、サーバー継続版の停止保証としてはまだ使えない。
採番・SQLファイル・環境設定変更は行っていない。

## Claudeが画面で使う口と型

| 口 | 用途/今回の状態 |
| --- | --- |
| `POST /api/booking/payments/start` | 担当者用。`{ bookingId, idempotencyKey? }`。再試行は200と元の`data.checkoutUrl`。 |
| `POST /api/liff/booking/payments/start?liffId=...` | 本人用。`{ bookingId }`。LINE認証を維持。再試行は200と元の`checkoutUrl`。 |
| `GET /api/booking/admin/sales-summary?account_id=...&from=YYYY-MM-DD&to=YYYY-MM-DD` | `total/menus/weekdays/previous`に`paidRevenue`追加。`timeZone`追加。`revenueSource`は常に`menu`。 |
| `GET /api/hq/banners/projects/:id` | 既存。戻ったときにimages/generationsを読む。サーバー継続の実装は保留。 |
| `GET /api/hq/banners/generations/:id` | 既存。生成の状態を読む。 |
| `POST /api/hq/banners/generations/:id/cancel` | 既存。上述の競合対策が必要。今回、新しい停止APIは作っていない。 |

新しい予約売上型は `@line-crm/shared/audit4-api` の `BookingSalesSummary`。
Webの呼び口は `apps/web/src/lib/api-audit4.ts` の `bookingSalesAuditApi.getSalesSummary`。
`api.ts` と共有型の `index.ts` は並行担当が変更中なので触らず、専用サブパスと専用ファイルにした。

反映履歴は依頼された `docs/release-log/unreleased/audit-codex4.md`。PR番号は未採番なので付けていない。司令塔がPRを作ったら、規定の番号入りファイル名・本文へ整える。

## 検証記録

ログはこのPCの `/tmp/lh-audit4-*.log`。期待どおり落ちたW45/WEB206の診断試験は、未実装部分の証拠として `/tmp/lh-audit4-w45-verified.repro.test.ts` と `/tmp/lh-audit4-web206-verified.repro.test.ts` に保管した。
通常のWorker試験へ混ぜて合格扱いにはしていない。W45・WEB206は未完了。
Workerビルドは合格。全体試験は他のVitest終了をpgrepで確認してから1回だけ実行し、868ファイル合格、10,138試験合格・既存スキップ30件（合計10,168件）。

全体試験中に本線が更新されたため、終了後に再取得し、最新 `405a2a45133d54ba6c50a429c388f374a88330e2` をmergeで取り込んだ。
追加分は画面・撮影用スクリプト・他の反映履歴。`apps/worker`、`packages`、依存定義・lockfile・共通tsconfigが全体試験時と完全一致することをdiffで確認した。
Worker全体の再実行はせず、影響するWebの型検査を再実行して合格した。取り込みのコミットは `a77be19bf3`。
完了時のクリーン確認は最終報告に記す。

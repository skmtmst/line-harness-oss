# revfix-g: 列車19の下流8件の再現と修正

対象の静的点検は `ec971ed64783737a515f00ae6f8e7838c14024d2`。元報告は読み取りのみ。
作業開始・初回全体試験前の本線は `a23c6681300665bf22c3a5036a4e9e54c4f9d93c`。
最終検証前に更新された本線 `aba7e15838abccb4f8d1f8ab417139be66f420ac` を競合なくmerge。追加差分は検証スクリプトとその試験・反映履歴の3ファイルのみ。
ブランチ: `codex/kenta-revfix-g-1011`。作業場所: `~/lh-work/lh-pages-revfixg`。
`DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` は合格。実DB・実送信・決済・EC操作なし。追加試験はSQLite fixtureを使い、fetchを禁止する偽物に置換。

## ID別の結果

| ID | 再現・確かめた条件 | 修正 | 仲間を確かめた数 | 見張り |
|---|---|---|---|---|
| D-01 | 回答の数値更新後、上位の完了記録だけを例外にする。共通情報/情報欄のadd/subの4例で再開時に二重増減 | 数値更新と受領記録を同一batchにする。別回答は別の効果。1回だけの操作は元のアクションキーを優先し、イベント・公開版が変わっても増やさない | 数値実装2本、増減4組。研究・シナリオ・自動応答の共通実行器を確認 | `research-numeric-replay.test.ts`。中断4組、記録失敗のrollback、同じ回答の並行再開。`numeric-once-recovery.test.ts`2例を合わせ計8例 |
| D-02 | 研究回答のclearで値をDELETE後、既存登録のある値なしの友だちを定期走査が拾い直す | 指示どおり修正なし。既存の回復経路あり | 情報欄保存3口＋定期補完1口＋研究clear1口 | `downstream-conditional-recovery.test.ts`。次の走査でactive→cancelled、取消理由を確認 |
| D-03 | 未公開・停止中の移動先。完了扱いになることを試験で確認。成功する移動・他の稼働中購読がある並行不可・保存失敗も確認 | 先へ登録後に元を止める。失敗は上位の未完工程に残す。再開用の登録IDを固定。再開・新規開始とも停止の直前に移動先の稼働状態を原子的に再確認 | 共通の操作を呼ぶ4口＋DBの移動1口 | `scenario-transition-recovery.test.ts`。元の維持、失敗が見える、成功時の戻り先、停止保存失敗後の再開。`scenario-resume-race.test.ts`4例を合わせ計10例 |
| D-04 | 3工程それぞれの台帳INSERTをDBトリガーで停止。旧実装は成功を返し、台帳なしのタグが残る | タグINSERTと3工程の宣言を同一batchで保存。台帳なし・予約失敗では外へ出る処理を実行しない | helper利用19口/14ファイル。工程宣言は共通の1口 | `friend-tag-atomic-attach.test.ts`5例＋既存台帳14例。rollback、保存応答消失、重複・並行、legacy付与、結果不明を再送しない |
| D-05 | 通常フォーム/研究の解除でtag_changeが0回。シナリオ/質問選択肢でも同じ漏れを再現 | 解除helperへ接続。同じ工程キーで成功済みを保存、外への結果不明は自動再試行せず通知センターへ1件 | `removeTagFromFriend`の元の呼出し6口。フォーム・シナリオ・質問の3口を修正。手動1口は通知済み。イベント内の自動化2口は連鎖仕様を変えない | `form-tag-detach.test.ts`4例＋`tag-removal-siblings.test.ts`2例。発火、再開で重複なし、結果不明の未完維持・確認通知、記録失敗でタグを戻す |
| D-06 | Aが来店と押印なしを読んで停止。取消後の最新queueをBが処理/削除。その後Aを再開すると旧実装は押印 | 3種類の自動書込を状態・版・時刻・queue世代の条件SQLで守る。wallet作成/受取ボーナス/失効にも同じ条件を使用 | 自動押印・取消・復元の3口×飲食/通常予約の2種。関連wallet書込も確認 | `visit-stamps-stale-consumer.test.ts`6例。古い押印/取消/再確認をそれぞれ2種類の予約で検証 |
| D-07 | V6予定取消後、予約UPDATEをDBトリガーで失敗。半端な状態と失敗工程が残り、同じ回答キーの再開で予約・予定・繰上げが整合 | 指示どおり修正なし。既存の回復経路あり | 取消前処理と受領記録後のfinish/replayの2口 | `downstream-conditional-recovery.test.ts`。失敗時の未完維持、再開後の取消整合、繰上げを二重登録しない |
| D-08 | イメージマップと素材4種に引用符・改行・バックスラッシュを差し込む。旧実装で構文エラー/キーだけの変数の誤検出 | 8種類のLINE構造種別と共通の素材4種の全12種で、JSONの文字列値だけを置換 | 展開22口/14ファイル、構造種別12種、内部の差し込み実装1口 | `common-var-structured-types.test.ts`14例。12種、実際のimagemap組立、JSONらしいplain textを本文のまま保つ。既存33例も確認 |

## 修正しなかった条件と限界

- D-02: `processFriendFieldReminders` → `getFriendsWithFieldValuePage` は日付値が消えていてもactive登録のある本人を拾い、`getOneTimeFriendFieldReminderRegistrants` → `friendFieldReminderTargetStatements` で取消する。試験は「同じアカウント・フォロー中・機能有効・毎年ではない日付起点・次の定期走査」を固定。即時取消や、次の走査より先に配信する競合まで保証した結果ではない。依頼の「回復経路が在れば直さない」に従った。
- D-07: 失敗したフォーム工程は完了にならず、同じ回答を再開するとcancelByTriggerをもう一度通り、予約と受領記録を保存してfinishへ進む。受領記録後に落ちてもfinishを再開する実装も確認。自動cronがすべての回答を再実行するという保証ではなく、同じ回答キーでの再開の証拠。依頼どおり変更なし。
- D-04: 以前から台帳の無いlegacy付与は勝手に再発火しない。これは外へ既に出たか分からない結果を再送しないため。今回、新規付与でその状態を作らない対策を行った。
- D-05: `automation-action-executors.ts:293` と `event-bus.ts:589` のタグ解除は、イベント内のアクション実行口であり、解除→別イベント→自動化の新たな連鎖を足す仕様変更はしていない。追加のSQL直書きも点検し、`packages/db/src/tag-definitions.ts:812`（タグそのものの削除）、`routes/profile-refresh.ts:464`（復元対象の置換）、`services/nen-rank-delete.ts:51`（ランク定義の削除）は通常の個別タグ変更から除外。手動の`routes/friends.ts:1436`は既存のfireEventを維持。フォーム・研究・シナリオ・質問の通常状態変化は修正済み。
- 元の28件、仕様回答待ち3件の残りはこの担当へ広げず、元報告を読み取りで照合した。

## revfix-fとの照合

開始時のrevfix-fは`1aa2df55f6`で、固有のフォーム修正コミットは未作成だった。
その後追加された `2cea6c06badf1ac6684234b86b3d662bd3ba7b3b` のR-FORM02を確認し、登録先の工程処理・helper・回帰試験の3ファイルを取り込んだ（`a8c2c15809`）。
先頭importの周辺はこの枝で変わっているため文脈を合わせ、本文の工程処理は同じ変更。試験のD1 batchの型指定を`8bfa55609a`で補った。
他担当の実装・未コミット変更は変更していない。

## 同じ書き方の場所

数値実装: `apps/worker/src/services/scenario-actions.ts`の`applyFriendField`と`applyCommonVar`。呼出しは`research-forms.ts`/`scenario-actions.ts`/`auto-reply-operator-action.ts`/`scenario-question-answer.ts`/`step-delivery.ts`。
D-03のDB移動: `packages/db/src/scenarios.ts`の`moveFriendScenarioTo`は既に移動先成功後に元を閉じる。残る共通の操作口は以下。

D-02: 保存の3口は `packages/db/src/friend-fields.ts` の単一保存・複数欄保存・複数友だち保存。回復の1口は `apps/worker/src/services/friend-field-reminders.ts:45` と `packages/db/src/reminders.ts:2620`、clearの1口は `apps/worker/src/services/scenario-actions.ts` の情報欄clear。
D-05: 修正の3口は `apps/worker/src/services/form-layout-effects.ts`、`scenario-actions.ts`、`scenario-question-answer.ts`。手動1口と未変更2口は前節に記載。
D-06: `apps/worker/src/services/visit-stamps.ts:341` 内のvisit/reverse/restoreの3口を両予約種別で確認し、同ファイルの`stampWallet`とqueue処理も点検。
D-07: `apps/worker/src/services/event-booking-action.ts:65` の取消前処理、同`:28`と`:46`のfinish/replay経路。

### runScenarioOp

- `apps/worker/src/services/form-layout-effects.ts:799`
- `apps/worker/src/services/step-delivery.ts:766`
- `apps/worker/src/services/scenario-question-answer.ts:202`
- `apps/worker/src/services/scenario-actions.ts:482`

### attachTagAndFireSideEffects

- `apps/worker/src/routes/forms.ts:3511`
- `apps/worker/src/routes/liff.ts:363`
- `apps/worker/src/routes/booking.ts:1278`
- `apps/worker/src/routes/conversions.ts:1831`
- `apps/worker/src/routes/webinars.ts:242`
- `apps/worker/src/routes/webinars.ts:315`
- `apps/worker/src/routes/webinars.ts:428`
- `apps/worker/src/routes/webinars.ts:790`
- `apps/worker/src/services/form-layout-effects.ts:610`
- `apps/worker/src/services/form-layout-effects.ts:750`
- `apps/worker/src/services/webinar-action-runner.ts:100`
- `apps/worker/src/services/tap-extras.ts:31`
- `apps/worker/src/services/nen-tag-sync.ts:405`
- `apps/worker/src/services/friend-bulk-runs.ts:653`
- `apps/worker/src/services/friend-bulk-runs.ts:894`
- `apps/worker/src/services/scenario-question-answer.ts:181`
- `apps/worker/src/services/friend-add-routing.ts:1434`
- `apps/worker/src/services/rich-menu-tap.ts:64`
- `apps/worker/src/services/tracked-click-steps.ts:56`

### expandSendCommonVars

- `apps/worker/src/routes/liff.ts:1190`
- `apps/worker/src/routes/liff.ts:2463`
- `apps/worker/src/routes/ec-commerce.ts:1125`
- `apps/worker/src/routes/ec-commerce.ts:1126`
- `apps/worker/src/routes/ec-commerce.ts:1127`
- `apps/worker/src/routes/webhook.ts:851`
- `apps/worker/src/routes/webhook.ts:991`
- `apps/worker/src/routes/webhook.ts:1086`
- `apps/worker/src/routes/friends.ts:1736`
- `apps/worker/src/routes/friend-add-rules.ts:1695`
- `apps/worker/src/services/operator-notification-dispatch.ts:445`
- `apps/worker/src/services/form-layout-effects.ts:682`
- `apps/worker/src/services/form-layout-effects.ts:702`
- `apps/worker/src/services/form-layout-effects.ts:722`
- `apps/worker/src/services/ec-event-processing.ts:371`
- `apps/worker/src/services/scenario-question-answer.ts:149`
- `apps/worker/src/services/scenario-question-answer.ts:225`
- `apps/worker/src/services/carousel-tap.ts:88`
- `apps/worker/src/services/rich-menu-tap.ts:102`
- `apps/worker/src/services/auto-reply-unmatched.ts:25`
- `apps/worker/src/services/event-bus.ts:626`
- `apps/worker/src/services/automation-action-executors.ts:425`

## migration・実環境操作

migrationの作成も提案も無し。既存の工程台帳・監査受領記録・来店版とqueue世代を使う。
D1適用・検証/本番DB更新・本物のLINE/メール/決済/EC送信・push・PR・配備は実施していない。
反映履歴は`docs/release-log/unreleased/0000-kenta-revfix-g.md`。PRを採番する司令塔が0000と#0000を実番号へ置き換える。

## 検証

再現で落ちた試験と修正後の結果は `/tmp/revfixg-d01-red.log`、`d03-red.log`、`d04-red.log`、`d05-red.log`、`d05-siblings-red.log`、`d06-red.log`、`d08-red.log`（すべて同じ`revfixg-`接頭辞）の記録。
全体試験前に本線を再取得しSHAが同じことを確認した。重い処理は1つずつ、vitest maxWorkers=4。
追加の再現:
- D-01: `numeric-once-recovery.test.ts`2例が12→14の二重加算で失敗。キーを直して既存を合わせ49例合格。
- D-03: 最初の追加fixtureは並行不可の既定値により想定した移動先が作られていなかった。その記録は再現の根拠に数えない。並行許可と実際の登録成功をassertしたfixtureで、再開・新規開始×移動先終了・非公開の4例が失敗。書込時の再確認を加え、既存を合わせ51例合格。再現ログ `/tmp/revfixg-d03-resume-red.log`。
- 初回の全試験: Workerだけ既存の`form-layout-effects.test.ts`2例が失敗。登録の偽物がundefinedを返し、引数数とタグ解除helperが旧実装に固定されていた。成功の偽物・新しいhelperを使うように修正し、`failedEffects=[]`も確認。関連58例合格。試験削除なし。

検証したコードHEADは `64f485fe59`（本線 `aba7e15838abccb4f8d1f8ab417139be66f420ac` を含む）。API URLはすべて `https://nen-line-stg.skmtmst.workers.dev`。これはビルド/試験の設定であり、実環境への送信・DB書込は行っていない。

| 検証 | 結果 | ログ |
|---|---|---|
| workspace全試験（Worker以外） | 2,655ファイル、15,857試験合格。既存skip1/todo1。最初の全体実行で確認、その後この領域の実装変更なし | `/tmp/revfixg-full-tests.log` |
| 最終Worker全試験 | 942ファイル、11,111試験合格、既存skip30 | `/tmp/revfixg-worker-final-tests.log` |
| スクリプト全試験（sharedの試験も含む） | 104ファイル、940試験合格。取り込んだ本線スクリプトの新版も検証 | `/tmp/revfixg-scripts-tests.log` |
| サイト試験（workspace外） | 21試験合格 | `/tmp/revfixg-site-tests.log` |
| workspace全体の型検査 | 合格 | `/tmp/revfixg-full-typecheck.log` |
| スクリプトの型検査 | 合格 | `/tmp/revfixg-scripts-typecheck.log` |
| workspace全ビルド | 合格。既存の反映履歴・Lint・chunkサイズ等の警告あり、失敗なし | `/tmp/revfixg-full-build.log` |
| 差分検査 | `git diff origin/codex/development --check` 合格 | 最終確認も実施 |

初回のWorker単体型検査では依存の生成物不足と2つのfixtureのbatchジェネリック指定不足が出た。依存をbuildし、fixtureの型指定を修正して、上記の全体型検査で通過を確認した。
初回の全体試験の失敗2件は上に記載し、最終Worker全試験で解消を確認した。

機能別のコミット（時系列）:
- `6dfb5b3be3` D-01 数値効果と受領記録
- `e2a736fb6d` D-03 移動先成功後に元を停止
- `0a0e0ea1e7` D-04 タグ付与と工程宣言
- `e432600636` D-05 フォーム解除と結果不明の確認待ち
- `bf42c555cb` D-06 古い押印/取消/復元の排除
- `19010cafbb` D-08 JSONの値として差し込み
- `a8c2c15809` revfix-f 登録先回復の取り込み
- `8bfa55609a` 回復fixtureの型修正
- `ec8888286e` D-05 シナリオ/質問の解除
- `6f38613b5d` D-02/D-07 既存回復の証拠
- `b94e49b745` D-01 1回だけの安定キー
- `6bdd6d750c` D-03 移動中の先の状態変化
- `3cd3f14e84` 既存フォームfixtureの更新
- `64f485fe59` 最新本線の取り込み

最後の報告コミットのSHAとクリーン確認は引き渡しの返事に記載する。

実行コマンド（各行を順番に実行、外部送信/DB適用コマンドは含まない）:
```sh
NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm -r --workspace-concurrency=1 --filter '!./sites/musubo' run test --maxWorkers=4
NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm --filter worker run test --maxWorkers=4
NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm run test:scripts --maxWorkers=4
NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm --dir sites/musubo run test
NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm -r --workspace-concurrency=1 run typecheck
NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm run typecheck:scripts
NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev npm_config_workspace_concurrency=1 pnpm -r --workspace-concurrency=1 run build
```
最初の全workspace試験は前述のフォームfixture2件で終了コード1。ほかのworkspace試験の成功と、修正後のWorker全体の終了コード0を別々に記録している。

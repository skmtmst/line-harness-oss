# 列車14 P2-01〜04 修正記録（2026-10-10）

今の進捗を全体像から整理するとこれ：列車15・16でも再現した8件を、既存の公開入口と共通部品の接続で修正。統合・検証への配備は司令塔の工程です。

## 土台・範囲

- 作業場所：`~/lh-work/lh-pages-stgfix14`、枝 `codex/kenta-stgfix14-1010`。
- 指定の列車16 `d3435b5c7de143234d1cfacb7cbfabc778398993` の上。本線は取り込んでいません。
- 列車15 `132ca087dd43be431ee8a1b62693aef1365d1c5d`、列車16の両方で、同じ外部15試験の8失敗（LIFF5・名前3）／7合格を確認しました。
- 元の `reproduce-local.sh` も実行し、LIFF5・名前3の失敗を確認。元の検証記録・証拠は変更していません。
- 外部の該当3試験を `apps/web/src/test-utils/staging14/` へ取り込み、絶対パスと外部HTMLへの書き込みを除去。追加の入口・再試行・競合試験もリポジトリ内で実行します。
- doctor「合格」。元の列車12・新作業ツリーは開始時クリーン。親ECのクリーンも確認。親のファイルは変更していません。
- push・PR・D1更新・配備・実送信・実決済は行っていません。すべての書き込み試験は模擬APIまたはメモリー上のSQLiteです。

## 入口の方針と修正

入口は既存Workerのまま。URL・LIFF ID・本人確認・決済の戻りは変えません。別ホストへの転送やSDKの再初期化も加えていません。予約の戻りや、旧フォーム独自のX連携（部分回答・受け取り条件・Webhook）を一括で置き換える危険を避け、依頼で許可された「配備側の画面へ同じ部品をつなぐ」を選びました。

| 対象 | 共通の機能への接続 |
|---|---|
| P2-01 | `BookingIntake`と`BookingCancelDeadline`を新LIFF・Worker両方で使用。質問・サーバーが返す期限を表示。送信の認証と操作キーは従来のまま |
| P2-02 | `FormReception`で締切・1人1回・総残枠を表示。選択肢の受付表示も共通化し、満杯のradio・checkbox・optionを無効化。レイアウトの選択肢IDと旧fieldsのラベルを対応。受付停止と満杯選択の送信も止める |
| P2-03 | 配備用`mountAffiliate`に既存`MileageRewards`・`AffiliatePayments`を接続。入口のアクセストークンを渡し、失敗・再試行・保存版・操作キーを共通部品で扱う |
| P2-04 | `InlineEdit`は失敗・false・blur・外からの値変更で下書きを保持。プールは共通の比較／読み直しへ接続し、競合中の保存を止める |

追加機能の二重実装を作らず、質問・期限・受付表示は新LIFF側の既存処理を共通部品へ抽出しました。マイル交換・口座編集は既存部品そのものです。独立LIFFとWorkerはそれぞれの配備の入口として残り、全ページを統合したという意味ではありません。

WorkerではLIFFの色・角丸の値とutilityだけを共有し、全画面へのpreflightは読み込みません。トークンは`tokens.css`一箇所へ移し、LIFF自身も同じ値を読みます。フォームのReact表示は動的に読み込み、他の入口の初期読み込みへ加えません。

## 保存版・変更した試験（PR用）

プールの既存`updated_at`を保存版として照合します。名前保存では`expectedUpdatedAt`を必須にし、UPDATE自体にも保存版の条件を付けました。読み取りから書き込みの間に相手が保存しても上書きしません。同じ時刻でも版が進む既存`nextVersionToken`を使用します。最新を取るGETも既存の閲覧権限の門の内側へ追加し、一覧と同じowner/adminの範囲に固定しました。OpenAPIにもGET・PUTと保存版、409の返り方を記載しました。migrationは不要で、追加していません。

既存InlineEdit試験の「失敗したら元の値に戻る」を「書いた下書きが残る」へ変更しました。理由は§6.11.9で入力保持が決まりだからです。保存成功・Esc・未変更・IME・権限の試験は残します。プール保存試験は保存版の送信を検査する形へ更新しました。LIFFの色の検査は抽出した同じトークンのファイルも読む形へ更新し、期待する値は変えていません。新GETの権限登録は既存の一覧と同じowner/admin専用として明記し、スタッフへの権限拡大はしていません。OpenAPIの既存PUTを未記載一覧から記載済み一覧へ移しました。

## InlineEditの利用箇所

`rg -n '<InlineEdit\b' apps/web/src --glob '!*.test.*'`：**19ファイル・19箇所**。旧app内のV8ファイルも含むコード上の利用箇所です。稼働する画面数とは区別します。

| 利用ファイル | 箇所 |
|---|---:|
| `apps/web/src/app/contents/vars/list-v8.tsx` | 1 |
| `apps/web/src/app/events/events-list-v8.tsx` | 1 |
| `apps/web/src/app/tags/fields-tab-v8.tsx` | 1 |
| `apps/web/src/app/tags/marks-v8.tsx` | 1 |
| `apps/web/src/app/tags/searches-v8.tsx` | 1 |
| `apps/web/src/app/templates/list-v8.tsx` | 1 |
| `apps/web/src/app/webinars/list-v8.tsx` | 1 |
| `apps/web/src/components/chats/friend-info-sidebar.tsx` | 1 |
| `apps/web/src/v8/affiliates/drawer.tsx` | 1 |
| `apps/web/src/v8/common-vars/list.tsx` | 1 |
| `apps/web/src/v8/events/list.tsx` | 1 |
| `apps/web/src/v8/forms/list.tsx` | 1 |
| `apps/web/src/v8/scenarios/list.tsx` | 1 |
| `apps/web/src/v8/tags/fields-tab.tsx` | 1 |
| `apps/web/src/v8/tags/marks-tab.tsx` | 1 |
| `apps/web/src/v8/tags/searches-tab.tsx` | 1 |
| `apps/web/src/v8/templates/list.tsx` | 1 |
| `apps/web/src/v8/webhooks/incoming.tsx` | 1 |
| `apps/web/src/v8/webinars/list.tsx` | 1 |

## 検証結果

取り込んだ追試の入口：`bash scripts/codex/reproduce-stgfix14.sh`。外部の旧作業ツリーに固定された試験ではなく、この作業ツリーのコードを実行します。

- 取り込んだ外部追試15件と追加の入口・保存・競合・既存試験：Web32件＋Worker5件、計37件合格。列車15・16で落ちた8件もすべて合格。
- すべての模擬書き込みで実API・実LINEへ送っていません。入口の失敗後の入力・同じ操作キー・同じ認証を検査しています。
- 追加APIのOpenAPI・権限登録・保存・既存プールの機能権限：4ファイル31件合格。全試験で検出した仕様書・権限登録の漏れを修正しました。
- 全試験は `NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev` で実行。ワークスペース全対象を以下のとおり完走しました。Webの自動ブラウザー試験9件も合格。開発サーバー・Playwrightは同時に増やしていません。

| 試験対象 | ファイル | 合格した試験 |
|---|---:|---:|
| docs | 2 | 6 |
| SDK | 11 | 53 |
| shared | 30 | 357 |
| update-engine | 20 | 160 |
| LIFF | 66 | 418 |
| Web | 2116 | 12356（別にskip1・todo1） |
| DB | 374 | 2239 |
| create-line-harness | 8 | 52 |
| MCP server | 3 | 68 |
| Worker | 919 | 10867（別にskip30） |
| 運用スクリプト＋shared | 99 | 903 |

型検査：`pnpm typecheck` 合格。最後に変更したWebの試験とWorkerのAPIもそれぞれ再検査しています。追加のWorker client全体の型検査だけは、今回触っていない `nen-member/main.tsx:620:85` の `string | null | undefined` → `string | undefined` のTS2345が1件残ります。同じコマンドをクリーンな列車16でも単独実行し、同じ1件だけの失敗を再現しました。今回のform・salon-booking・affiliateの入口を対象にしたclient型検査は合格。

ビルド：`pnpm build` 合格（Web・LIFF・Workerの配備用clientを含む）。共有トークンが出力CSSに入ることも確認。最終APIの変更後、Workerの型検査・ビルドを再実行して合格。差分の空白検査も合格。開発サーバーは試験が終了すると停止しています。

故障検出：下の変更を1つずつ一時適用し、構文・読込エラーではなく実際の検査が落ちることを確認。すべて戻したあと、上記37件の追試が再び合格しました。

| わざと壊した箇所 | 落ちた試験 |
|---|---:|
| 質問を固定の「ご要望」に戻す | 2 |
| キャンセル期限を隠す | 2 |
| 満杯の選択肢の無効化を外す | 1 |
| マイルの使い道の部品を外す | 2 |
| 振込先の編集部品を外す | 2 |
| InlineEditの失敗で元の値へ戻す | 4 |
| プール409の共通比較への接続を外す | 3 |
| DBのUPDATEから保存版の条件を外す | 2 |

ローカルの実行ログ：`/tmp/stgfix14-replay-final.log`、`/tmp/stgfix14-all-tests-serial.log`（完走した前半のパッケージ）、`/tmp/stgfix14-all-tests.log`（Web・DB・create・MCP）、`/tmp/stgfix14-worker-all-final.log`、`/tmp/stgfix14-script-tests.log`、`/tmp/stgfix14-typecheck-final.log`、`/tmp/stgfix14-client-typecheck-final.log`、`/tmp/stgfix14-client-baseline.log`、`/tmp/stgfix14-build-final.log`、`/tmp/stgfix14-mutations.json` と各mutationのログ。

## 実装コミット

- `96582842031b5eecb0507e803d124929b0a33368`：配備されるLIFF入口から共通機能へ接続。
- `5256676a82110f7f259913a5af9f75a5a9cc938e`：名前の下書き保持、プールの保存版照合・比較・読み直し。
- 修正記録・反映履歴・追試スクリプトは別の1コミットへまとめました。

## 残り

P2-05の全板の照合とP3-01の速度、既存NEN clientの型エラー1件は今回の修正範囲外です。元の追試に含まれる過去CIの速度結果の再判定は、その保存済み指標を読むため修正コードの速度測定にはなりません。実LINEの認証・実顧客への送信・実決済・実口座変更・実D1の同時更新は行っていません。

次のタスクはこれ：司令塔がコミットを取り込み、PR番号を反映履歴へ付け、対象板の照合と検証環境への配備後の入口確認を行う。

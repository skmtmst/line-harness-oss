# 整理 段2 A02：店舗設定の初期化

## 範囲と土台

- 作業枝：`codex/kenta-train-cleanup-a02-1018`。
- 開始・検査前 fetch の本線：`ff1308a85c7178787fc5d9bbfce4c431a92b07d7`。取り込みは already up to date。
- doctor：`DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` 合格。開始時クリーン。
- 契約：`docs/v8-requirements/cleanup-stage2-contract.md` §2-1、分担表の A02 と「ぶつけない渡し方」。
- 実送信・決済・外への書き込みは禁止のため、B-358 の Slack 宣言は未送信。Slack の文や所有範囲を変更せず、宣言する内容は「A02：style-setup の店舗初期化と新設 DB 補助、既存 LINE 登録の動作を保つ」に限定。

## 変更した動作

`PUT /api/dashboard/style?account_id=...` の既存の認可・入力・応答を保持。`saveProfile` の版確認・回答保存・見本作成・監査と同じ D1 batch 内で、保存済み回答から店舗の欠けた設定だけを登録する。既存の LINE 登録2経路が呼ぶ `initializeAccountStyle` とその見本16件・選択保留の動作は変更していない。

- `booking` → `reservation`、`coupons` → `coupon` のみ。`configured` の JSON boolean だけを使う。
- 未回答・`manual`・`later`・文字の `true` は設定行を作らず、後から明示回答できる。
- 行の存在が初期化済みの印。オフも含め、既存行の値・版・設定・担当・日時を変更しない。設定をオフにする利用側も行を消さず `enabled=0` を保存し、この印を残す。
- 回答の版確認が負けた場合も後続が失敗した場合も、回答と店舗設定は同時に巻き戻る。
- 同じ LINE アカウントに明確に結び付く1店舗だけ。現在の店舗・組織・アカウントの所属と稼働状態を SQL 実行時にも確認する。組織の旧形式は組織が当該アカウントを明示している場合だけ許す。
- DB 補助は `packages/db/src/store-feature-initialization.ts` の `storeFeatureInitialization(db, accountId, tenantId, actorId, nowMilliseconds, storeId?)`。実行せず prepared statement を返す。呼び出し元は保存/作成と同じ batch に入れる。共有の index や型へ export を追加していない。
- 承認方法・支払方法などの版付き設定、delivery の旗、analytics・schedule、認証、外部 adapter、既存 DB 補助、共有の型、画面は変更しない。

## 他束へ渡す残り

店舗作成の実入口は `apps/worker/src/routes/restaurant-test.ts`（A02 所有外）。「共通の1行も持ち主へ返す」に従い、変更していない。後から作る店舗への**作成直後の自動反映は未接続**であり、完了扱いにしない。現時点でも、その店舗で次に回答を保存すると保存済みの明示回答を初期化できる。

司令塔から店舗作成の持ち主へ、次を渡す：

1. `POST /api/restaurant-test/stores` の INSERT と本 helper を同じ `dbFor` の batch にする。確認済みの LINE アカウント ID・組織の tenant・操作者・新店舗 ID を渡す。
2. `stores/connect` は新規 LINE アカウントに保存済み回答がないため初期化0件になる。既存の接続・失敗時の後片付けを保つ。
3. 店舗の LINE アカウントを後から結ぶ PATCH にも、同じ batch で本 helper を接続できる。既存の店舗設定があれば必ずそちらが勝つ。

店舗作成＋初期化の atomic batch の成功・後続失敗による全巻き戻し・再実行の上書き0は、実 SQL の試験で確認。実入口への接続試験は持ち主の差分で追加する。新 migration は不要。

店舗旗の実行前 enforcement は他束の機能サービスの範囲であり、この初期化処理によって予約等の許可を追加しない。初期質問を稼働設定として読み直す仕組みも追加していない。

## 検証

- Node22、SQLite（外部キー ON）と既存の Hono 入口を使う。外部通信は実行しない。
- 初回 true/false、未回答/manual/later/非 boolean、再保存、スタイル変更、先行設定オン/オフ、店舗変更後、同時保存（200/409）、店舗更新との競合、途中失敗→同版再実行、店舗の後作成、別店/別アカウント/別 tenant、所属の途中変更、旧組織/アーカイブ、readOnly/staff 拒否、登録と GET の初期化0件を確認。
- 本部の初期セット再配布の既存試験にも、店舗設定の全項目が不変の確認を追加。
- 最初の8ファイル196件は、試験の店舗削除が既存の外部キーに拒否され2件失敗。守りを変えず、店舗のアカウント未接続を使う fixture へ修正し、同じ196件すべて合格。
- 追加の所属/失敗試験を含む最後の2ファイル42件も合格（新規23件）。
- Miniflare の実 D1 でも1件合格：WITH/INSERT SELECT/ON CONFLICT の実行、CAS 不一致・後続失敗で全巻き戻し、同じ版の再実行、明示オフの保持を確認。
- `pnpm --filter @line-crm/db typecheck`、`pnpm --filter worker typecheck`、`pnpm --filter worker build` は Node22 と heavy の共通枠で実行し、すべて終了0。ビルドの既存の大きいチャンク警告は上限変更せず保持。
- `git diff --check` 成功。生成物の追跡差分なし。

## ci-local の最終結果

検査対象は `573ea8c59b35313a2c221394f758c3aec1e8c1a3`、比較先は開始時の本線 `ff1308a85c7178787fc5d9bbfce4c431a92b07d7`。Node 22.23.3 / pnpm 9.15.4。各仕事は新しい作業ツリー、重い検査は既存の heavy 枠で実行した。待機時間を検査の実行時間や SQL の性能として扱わない。

| 検査 | 結果 |
|---|---|
| Worker 全体 | 1,096ファイル・12,947件成功、型検査成功 |
| DB 全体 | 392ファイル・2,292件成功、生成定義の一致・migration安全検査成功 |
| 管理画面全体 | 2,308ファイル・13,684件成功、既存 skip/todo 各1。lint・型・部品選択・V8固定成功 |
| 共有 / LIFF | 385件 / 531件成功、共有の型も成功 |
| リポジトリ用スクリプト | 1,091件成功・既存 skip 1、型検査成功 |
| 更新 / セットアップ | 160件 / 52件成功 |
| SDK / MCP | 53件 / 68件成功、MCPの型・ビルド成功 |
| 文書 | 6件成功、型・ビルド成功 |
| 管理画面ビルドと実ブラウザ | ビルド・Webhook画面・メディア権限・EC店切替・LINE通知・タグ編集・MFA 3幅・セキュリティ・設計値・保存/公開/競合の動作が成功 |
| Worker ビルドと実ブラウザ | 下記の補足実行で、ビルド・待機列の入口・セキュリティをすべて成功 |
| V8全画面の検査 | 補足実行の正規の差分判定で `run=false`。画面/共有型/視覚検査/lockfileの変更がないため対象外。見た目の新規合格とは数えない |

主実行：`zsh ~/lh-work/tools/hq/ci-local/run.sh ~/lh-work/lh-cl-a02`。114工程＝成功56・失敗3・省略55、うち手元で実行不能28、終了1。**集約は未合格**。PR作成前のためPR題名/番号が不明、さらにCI変数を引数で渡していないため、WorkerビルドとV8の判定が実行不能になった。ビルドしなかったWorkerのブラウザ2工程は、配信用ファイル/ヘッダーがないため失敗。残る失敗1件はその集約である。元ログを消したり、合格へ読み替えたりしていない。

リポジトリのGitHub Actions変数を読み取り、`VITE_LIFF_ID` / `VITE_BOT_BASIC_ID` / `VITE_CALENDAR_CONNECTION_ID` / `V8_SPEED_ENFORCEMENT` が未設定であることを確認した（値や設定は変更していない）。その空値を明示し、同じSHAで次を補足実行：

```sh
zsh ~/lh-work/tools/hq/ci-local/run.sh ~/lh-work/lh-cl-a02 \
  --job worker-build --job v8-screen-guard \
  --var VITE_LIFF_ID= --var VITE_BOT_BASIC_ID= \
  --var VITE_CALENDAR_CONNECTION_ID= --var V8_SPEED_ENFORCEMENT=
```

補足は43工程＝成功12・失敗0・省略31、うち実行不能1（PR情報だけ）、終了2。Workerビルドと両ブラウザ工程は成功、V8差分判定は成功して通常の `run=false` になった。速度検査は既存の既定値へ任せ、制限・許可・必須チェック・CIそのものは変更していない。実際のPRは作っておらず、仮の題名/番号で集約の合格を作っていない。司令塔はPR採番後に `#0000` とファイル名を実番号へ替え、通常のPRゲートを確認する。

記録：主 `/tmp/a02-ci-local.log` と `~/lh-work/tools/hq/ci-local/logs/20261017-235337-573ea8c59b-84059/`、補足 `/tmp/a02-ci-supplement.log` と `20261018-000215-573ea8c59b-94326/`。ローカルの型・ビルドは `/tmp/a02-types-build.log`。省略は実行済みの検査に数えない。

## コミットと引き継ぎ

- `20220b280b`：初期化本体・回帰試験・仮番号の反映履歴。
- `573ea8c59b`：所有範囲・店舗作成担当への接続・検証記録。この版で上記のci-localを実行した。
- 最後の追記はこの検証記録だけ。製品・試験・型・ビルドの入力には追加変更なし。最終SHAは完了報告と `~/lh-work/design/v8/review/API-CONTRACT-A02.md` に記す。
- push・PR作成・DB更新・配備・実送信・決済・Slack投稿なし。新migration、親ECの変更、上限・許可一覧の変更もなし。

今の進捗を全体像から整理するとこれ：A02の初期化本体と検証をコミット。店舗作成直後の実入口への接続は所有担当への引き継ぎで、未完了のまま明記した。PR情報が必要な集約も司令塔の工程へ残す。

次のタスクはこれ：司令塔が店舗作成の持ち主へ同じbatchでの接続を渡し、実入口の試験を追加して取り込み・採番・通常のPRゲートへ進む。

## 03:08 JST の続き：計画網羅と長いファイルの確認

- 再開時 `b7084f7d10` はクリーン、doctor 合格。まとめの枝 `e9b423eb7c798f7d5a530a05a6e86a0c26dd56f9` を通常の merge で包含（merge `698cb5027f944af099f2b0ff9f16f6f678d486d8`）。競合なし。fetch 後の `origin/codex/development` も同じ `e9b423eb7c`、既に包含済み。rebase・force は使っていない。
- `api-common.md` 末尾2節と `WORK-BUNDLES.md` の A02/「ぶつけない渡し方」を再確認。`PLAN-COVERAGE.tsv` の `primaryBundle=A02` は0件、`LONG-FILES-1018.tsv` の `bundle=A02` も0件。元計画の未処理ID・指定された分割対象はない。前回の初期化を作り直していない。
- A02 の確認範囲は style-setup/core、starter 6本、styles route、LINE登録を含む route、新設DB補助の11ファイル・3,947行で前後同数。1,500行以上は `routes/line-accounts.ts` 2,085行のみだが、長いファイル台帳では A08 所有。A02 は登録2経路の呼出しを保ち、ファイル全体の分割は A08 へ残す。`packages/db/src/line-accounts.ts` は A09、analytics/schedule は A10 のまま。
- この続きで製品・試験の削除/移動/改名・export/route順・応答の変更は0。見張りの削除/緩和、上限・許可一覧の追加も0。権限/別店/同時保存/CAS/原子的な巻戻し/実D1の既存試験をそのまま実行する。
- 店舗作成直後の実入口 `routes/restaurant-test.ts` への接続は前回どおり未完了。A02の書込み所有範囲を広げず、司令塔から所有担当（A08）へ渡す。helper単体の後作成試験成功を実入口の完了と混同しない。
- 4種類の完了記録は司令塔手元の `review/CLEANUP-1017/DONE-A02.tsv`。新 migration・外部への書込み・push/PR・DB更新・配備は実施しない。

この続きの検査結果は実行完了後に追記する。過去の実行結果を今回のSHAの合格として扱わない。

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
- 行の存在が初期化済みの印。オフも含め、既存行の値・版・設定・担当・日時を変更しない。
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
- ci-local の最終結果は検査終了後に追記する。

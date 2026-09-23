# Issue #626 調査報告（レーンB: staging基盤不安定）

調査日時: 2026-09-23 / ブランチ: `devin/626-staging-stability`（codex/development `fb51561f7` ベース）
調査方法: コード・クエリ構造の静的調査（staging への直接 API アクセス・D1 参照は権限外のため未実施）
結論: **コード修正なし**。09 は環境起因が最有力（コード側の増幅要因あり・要ログ照合）、32 は検知ロジックどおりの真陽性（staging の環境構成が原因）。

---

## 1. 09 友だち追加時の配信: 一覧読込の断続失敗（3回中2回）

### 対象口

- 画面: `apps/web/src/app/friend-add-settings/page.tsx:100` → `api.friendAddRules.list`（`apps/web/src/lib/api.ts:9676`）
- API: `GET /api/friend-add-rules` → `apps/worker/src/routes/friend-add-rules.ts:721-806`

### 1要求あたりの D1 往復（平たい一覧読込・検索なし）

| 段 | クエリ数 | 箇所 |
| --- | --- | --- |
| authMiddleware（セッション＋staff JOIN） | 1 | `middleware/auth.ts:466` → `packages/db/src/staff.ts:400` |
| tenantScopeMiddleware → getVisibleLineAccountScope | 2〜3 | `middleware/tenant-scope.ts:30` |
| featureEnforcementMiddleware（scope 再実行＋feature 判定＋billing 解決） | 4〜8 | `middleware/feature-enforcement.ts:584,593` → `services/feature-enforcement.ts:606-626` |
| route: canUseAccount → getVisibleLineAccountScope（3回目の scope 解決） | 2〜3 | `routes/friend-add-rules.ts:65-68,735` |
| route: ensureFriendAddFallbackRules（3読取＋条件付き書込 batch） | 3(＋書込) | `routes/friend-add-rules.ts:736` → `packages/db/src/friend-add-rules.ts:80-130` |
| route: Promise.all（listPage 2 + loadOptions 4 + 集計 3） | 9 | `routes/friend-add-rules.ts:737-773` |
| **計** | **約21〜26 ステートメント/要求** | |

`getVisibleLineAccountScope` は 1 要求で **3 回**実行される（tenant-scope → feature-enforcement → route）。

### 断続失敗の構造的候補（確度順）

1. **staging D1 の一時的エラーを、要求あたりの往復数が増幅**
   各 `db.prepare().all()` は D1 への個別 subrequest。1 画面表示で 20 発超の D1 往復をするため、クエリあたり数%の一時失敗率でも画面単位では「3回中2回」級の失敗になる（例: 5%/query → 1-(0.95^20) ≈ 64%）。「ページ再読込で回復→再度失敗」の観測パターンと整合。特定クエリの構造的欠陥（N+1・巨大 JOIN・bind 上限超過）は見当たらず、集計クエリもアカウント内集計で軽い。
2. **読み取り GET の中で書込みをする `ensureFriendAddFallbackRules`**（コード側の第二候補）
   `packages/db/src/friend-add-rules.ts:87-129`。受け皿ルール（`is_unknown_route_fallback=1`）が **kind のどちらかでも欠ける** と、閲覧中タブに関係なく `db.batch` で INSERT OR IGNORE ×2 + UPDATE を実行する。staging ではキュー消費（`nen-codex-mentions-stg` consumer）・Webhook 書込・併行テストと D1 書込が競合し得る（SQLITE_BUSY 系 → catch → 500 `'友だち追加時の配信を取得できませんでした'`）。
   - 受け皿が両 kind 揃っていれば読取のみで無害。staging の `friend_add_rules` 実データと Worker ログの照合が必要。
   - ログ照合先: `console.error('GET /api/friend-add-rules error:', error)`（routes/friend-add-rules.ts:803）。
3. **D1 の LIKE/GLOB パターン 50 バイト上限（今回の原因ではないが潜在不具合）**
   `r.name LIKE ? ESCAPE '\'` は検索 `q` 指定時だけ使われる（`packages/db/src/friend-add-rules.ts:229`）。監査は検索欄入力に到達していないため今回の断続失敗とは無関係。ただし `%検索語%` のパターンが 50 バイト超（日本語16〜17文字程度）で D1 がエラーを返し 500 になる構造で、別件として潜在不具合。`scenarios.ts:440` の `s.name LIKE` も同型。
4. **staging D1 のマイグレーション遅れ（別口の確定的 500 リスク）**
   `GET /api/friend-add-runs/:id` は `friend_add_action_runs.action_type / action_snapshot / started_at / completed_at` を選択（routes/friend-add-rules.ts:601-605）。これらは migration `407_friend_add_action_run_details.sql` で追加された列で、staging D1 が 407 未適用なら実行結果詳細が確定的に 500。一覧（rules list）自体は古い列だけを使うため今回の症状とは別。

### 判断

- 決定的なコード欠陥（毎回必ず失敗する条件）は見つからず、「成功→失敗→回復→再失敗」の断続性は **環境（staging D1/基盤）起因が最有力**。コード側は往復数の多さと GET 内書込みという増幅要因。
- 確定には Worker 側ログ（上記 console.error の実エラー）と staging D1 のデータ状態（受け皿2行の有無・`account_settings.friend_add_routing`）の照合が必要。レーン権限外のためここで打ち止め。

### 推奨対応（コード化するかは司令塔判断）

- `ensureFriendAddFallbackRules` を GET から外す（アカウント作成時/ルール作成時へ移す）か、失敗しても一覧を返すように non-fatal 化する（受け皿が無くても一覧表示自体は可能）。
- D1 一時エラー（`internal error`/`Network connection lost`/busy）に対する軽いリトライを往復の多い一覧口へ導入するか、scope 解決の 3 重実行を request 内で共有して往復を減らす。
- LIKE 検索の入力長を制限（パターン 50 バイト上限対策）。
- staging D1 の migration 適用状況の点検（357/358/407 以降の未適用が残っていないか）。

---

## 2. 32 運用状態: 手動チェックで「全体状態エラー」

### 対象口

- `POST /api/operations/health/runs` → `apps/worker/src/routes/operations.ts:151-172` → `runOperationHealthChecks`（`apps/worker/src/services/operations-health.ts:137`）
- 6 チェックを `Promise.all` + `isolate`（個別失敗は unknown 化）で実行（operations-health.ts:40-135）
- 全体判定: `overallHealthStatus`（`packages/db/src/operations-health.ts:337-342`）danger > warning > unknown > normal
- 画面: `apps/web/src/app/emergency/page.tsx:575-579` `displayedSeverity==='danger'` → 「エラー」

### 失敗しているチェック項目（確定）

**`dispatch_jobs`（配信処理）が danger → 全体 danger = 「エラー」**。根拠:

1. staging の Worker には **cron trigger がない**。`apps/worker/wrangler.staging.toml:5` に明記:
   `Intentionally has no [triggers] section, so scheduled delivery cannot run.`
2. heartbeat（`operation_dispatcher_heartbeats`）は `scheduled()` 内の `observeOperationDispatcher`（`apps/worker/src/index.ts:1705` → `services/operation-dispatch-health.ts:512`）でだけ書かれる。cron が無い staging では**一度も書かれない**。
3. `collectOperationDispatchHealth`（services/operation-dispatch-health.ts:387-496）は全 12 dispatcher を評価し、`heartbeatStatus === null` を **danger** と判定（同ファイル 366-385 の `healthStatus`）。
4. 結果 `dispatch_jobs.status='danger'` → `overallHealthStatus` が danger を返す → 画面「全体の状態: エラー 最新結果」。

この挙動は**設計どおり**で、テストでも明示されている（`apps/worker/src/services/operation-dispatch-health.test.ts:160-167`「heartbeat欠落と未知jobをnormalにしない」: 欠落 → danger を assert）。

### 他チェックの状況（全体を danger にし得る副次候補）

| checkKey | staging での予想 | エラーになり得るか |
| --- | --- | --- |
| line_connection | 監査観測では「正常」。`account_health_logs` の最新行を読むだけ（cron なしでも過去の行があれば正常） | risk_level='danger' の行があれば danger |
| message_quota | `fetchQuota`（LINE API, 10s timeout, `broadcast-quota-guard.ts:74-97`）。トークン無効・到達不可 → unknown | used/limit ≥95% なら danger（検証チャネルでは非現実的） |
| external_integrations | `outgoing_webhooks` の連続失敗数 | 連続失敗 ≥3 で danger（staging の送信先不通ならあり得る・未確認） |
| webhook | 直近1時間の `line_webhook_events` | failed ≥3 で danger。staging D1 遅れで受信処理が失敗していると danger 併発の可能性 |
| dispatch_jobs | **全12 job heartbeat 欠落 → 確定的に danger** | ← 主因 |
| friend_change | `friend_daily_snapshots` 2行必要（cron 不在で欠乏） → unknown | 減少率 ≤-10% で danger |

### 判定

- **実故障ではなく、検知ロジックの誤検知でもない**: staging は設計上スケジュール配信が動かない環境であり、「配信処理（dispatcher）が応答しない」を danger とする検知は**真陽性**。コードは意図どおり動いている。
- ただし運用者目線では「staging でいつも赤い」状態になり、本来見たい異常を埋もれさせる。扱いは製品判断。

### 推奨対応（選択肢）

- (a) 現状を正とする: staging では予約配信が本当に動かないため「エラー」は正しい警告として運用で読み替える。
- (b) staging に `[triggers]` を付けて scheduled を動かす: 検証で配信系まで確認したいなら環境側の変更（`wrangler.staging.toml` は意図的に cron なし設計のため要司令塔判断）。
- (c) 検知条件の見直し: 「heartbeat 行が一度も存在しない（never ran）」を danger ではなく unknown とする。ただし本番で「テーブル消失/初回デプロイ直後の dispatcher 沈黙」を danger として拾う現在の強度が落ちる（本番では cron があるため 5 分で自然治癒するが、治癒までの間の検知が弱まる）。実装する場合、`runOperationHealthChecks` は `db + input` しか受け取らないため、環境判別（`WORKER_NAME` 等の env）の引き回しが必要。

---

## 3. まとめと未解決事項

- **09**: 環境起因（staging D1 一時エラー）が最有力。コード側は 1 要求 20+ D1 往復・GET 内書込みという増幅構造。確定には Worker ログと staging データ照合が必要（権限外で未実施）。
- **32**: `dispatch_jobs` が danger（全 12 dispatcher の heartbeat 欠落）。原因は staging に cron trigger が無い環境構成。検知は設計どおりの真陽性。
- **コード変更**: なし（実故障がコードにあると確定できないため、レーン規約どおり調査報告のみ）。
- **未解決**: Worker 実ログ（`GET /api/friend-add-rules error:` / health run の `operation_health_results` 内訳）・staging `friend_add_rules` 受け皿行・staging D1 の migration 適用状況の照合。これらが取れれば 09 の 1番/2番候補を確定できる。

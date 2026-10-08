# V6 共通基盤 要件定義

> この文書は機能（動き）の正本。見た目は ★V8（[docs/v8-design-rules.md](../v8-design-rules.md)）が正本で、この文書の見た目・ノードID・V6 の絵の指定は使わない。

更新日: 2026-08-26
位置づけ: 全32機能より先に実装する横断契約

## 0. 目的

V6の各機能が同じ方法で、所属、権限、版、event、action、job、監査、media、分析を扱えるようにする。共通基盤は「大きな一枚岩」ではなく、機能から利用する小さな契約とserviceに分ける。

## 1. 基盤の8領域

| 基盤 | 提供するもの | 主な利用機能 |
|---|---|---|
| Scope | organization/account/operator/friend context | 全機能 |
| Authorization | deny-by-default、role、permission、項目マスク | 全機能 |
| Versioning | definition/version/publication/snapshot | 5〜13、16〜19、21、24、25、27〜29 |
| Event | receipt、domain event、schema registry | 8、18〜26、予約 |
| Action/Job | catalog、execution、Queue、retry、reconcile | 配信、通知、自動化、EC、外部連携 |
| Media | private original、derivative、利用先、同意 | 10〜15、21、22 |
| Audit/Secret | 追記監査、暗号化secret、再認証 | 全機能 |
| Metrics | metric event、daily aggregate、freshness | 1、18〜20、32 |

## 2. Scope契約

すべてのrepository/serviceは`RequestScope`を要求する。

```text
RequestScope
- organizationId
- lineAccountId
- operatorId
- membershipId
- permissionSet
- requestId
- timezone
```

- accountなしで業務queryを呼べない型にする
- 管理者でも任意account全件を暗黙取得しない
- 組織横断集計は専用`CrossAccountScope`と権限を要求
- friend、definition、job等をIDで取得した後もaccount一致を検証
- background jobは作成時のscope snapshotを持つが、実行時に現在のfeature/kill switchを再検査
- public/LIFF APIは公開先またはLIFF contextからaccountを特定

## 3. Authorization契約

```text
permission = domain.resource.action
例: broadcast.definition.publish
    photo.original.download
    affiliate.payout.export
```

- 権限モデルの正本は[30 ログインユーザー](./v6-30-login-users-requirements-draft.md) §7〜§8の三段階(`edit` / `view` / `none`)＋重要操作permission＋項目マスク。上の`domain.resource.action`は重要操作permissionの命名規則である
- 機能別要件のowner / admin / staff表は役割bundleの既定値であり、表中の「個別権限」「指定者のみ」はpermission keyの個別付与を指す
- 未分類endpointは拒否
- menu非表示、button非表示、API拒否を分ける
- permissionはorganization role＋account role＋個人overrideを合成
- 危険操作は再認証、MFA、二者承認を設定可能
- PII、口座、健康、同意、secret、original mediaは項目単位mask
- role変更・退職・account解除時はsessionを失効

## 4. Versioning契約

概念entity:

- definition: 論理的な設定の入れ物
- version: 不変の内容
- publication: どのversionをいつ使うか
- binding: 利用先が参照するversion
- snapshot: 実行時に固定したrender/condition/action

規則:

- published versionへのUPDATEをDB/serviceで拒否
- 新版は前版copyから作る
- publication切替はexpected versionで競合防止
- bindingは利用先単位。新版で自動変更しない
- queued jobはdefinitionだけでなくversion/snapshotを持つ
- archive後も過去executionから読める
- delete cascadeでhistoryを消さない

## 5. Event契約

### 5-1. Receipt

- provider/connector/account
- external event ID、topic、timestamp
- raw body reference、hash、signature result
- received/rejected/replayed/oversized
- bodyは暗号化またはprivate storage、監査へ転記しない

### 5-2. Domain event

- event ID、event type、schema version
- organization/account
- subject type/ID、actor type/ID
- occurred_at、recorded_at
- source receipt/record reference
- dataは型付きschema。secret/不要PIIを入れない

### 5-3. Schema registry

- event typeごとにversion、owner、producer、consumer
- backward compatibility test
- breaking changeは新schema version
- producer fixtureとconsumer contract test

## 6. Action/Job契約

### 6-1. Action catalog

正本は[25 接続契約](./v6-25-automation-action-contract.md)の「共通アクションのカタログ」である。ここでは再掲せず、段だけ引用する。

| 段 | 内容 | 依存 |
|---|---|---|
| 第1期 | タグ、友だち情報、シナリオ、LINE送信、外部Webhook、リッチメニュー | 接続契約あり |
| 第2期 | 対応マーク、担当者、マイル、通知、待つ、条件で分ける、別の共通アクションを呼ぶ | 17、24 の台帳 |
| 第3期 | コンバージョンの記録・訂正、予約・カレンダー操作 | 19、27 の API |

処理名は接続契約の表記をそのまま使い、機能別要件で別名を作らない。任意code/SQL/JSON式を実行しない。各action adapterが入力schema、権限、副作用、冪等性を持つ。

### 6-2. Execution

- event/rule/action version/targetのidempotency key
- input snapshotと安全な出力summary
- queued/claimed/succeeded/skipped/retry_wait/permanent_failed/cancelled
- skip reasonとpermanent error code
- provider request/reference ID
- next retry、attempts、lease expires
- manual retryは新しいattempt。成功済みactionを再実行しない

再試行の既定は次の1表とし、機能別要件は回数を独自に書かず「共通基盤 §6-2 の既定に従う」と参照する。

| 分類 | 既定 | 備考 |
|---|---|---|
| 外部APIの一時失敗(LINE、EC、カレンダー、決済) | 1分・5分・30分の最大3回(初回含め4回) | `429`は`Retry-After`を優先 |
| 送信Webhook(26) | 最大8回・24時間 | 相手サーバの長時間停止に備える。26だけの例外 |
| 内部処理(入力不備、権限不一致、宛先なし) | 再試行しない。恒久失敗 | skip reasonを残す |
| 手動再試行 | 新しいattempt | 成功済みは再実行しない |

### 6-3. Runtime gate

実行直前に順番に判定する。

1. system/feature kill switch
2. organization契約
3. account機能設定
4. definition/publication状態
5. subject状態・opt-out・block
6. quota/rate limit/quiet hours
7. sourceの取消・期限・重複

画面でONでもruntime gateが拒否できる。拒否理由は`skipped`として残す。

## 7. Media契約

- upload session→private original→検査→derivative
- magic bytes、decode、容量、pixel、形式、malwareを検査
- original keyは通常APIへ返さない
- public/review/thumbnail derivativeをversion化
- EXIF/GPSをpublic derivativeから除去
- asset bindingで利用先を把握
- 差替えは新asset version。過去versionを黙って変更しない
- 同意が必要なassetはconsent scopeをbinding時に検査
- archiveと撤回を分ける。撤回は公開cache/placementを失効

### 7-1. 危険なファイルの検査（2026-09-25 確定）

2026-10-08 に旧「未実装機能の確定」（履歴）の B から書き写した。対象はファイルを上げる口すべて（登録メディア 15、写真の投稿 22、回答フォームの添付 13、友だち属性の画像・PDF 04、メッセージの添付など）。

- 検査の順番：①中身の形（magic bytes）と拡張子・MIME の一致 ②許可された形式か ③大きさ・画素が上限内か ④読めるか ⑤危険な中身がないか
- 危険な中身の検査は、差し替えられる作り（scanner の口）にする。外部の検査サービスは、設定があるときだけ使う
- 既定の検査で見つけるもの（候補：画像の後ろに付いたデータ、PDF の JavaScript・埋め込みファイル・起動の指示、Office のマクロ、実行ファイルの印）は、実装前に決める（オーナー確認）。実行ファイルの印は必ず見つける
- 状態は `pending` → `clean`／`rejected`（理由のコード）／`quarantined`。`clean` になるまで、配信・公開・審査・LIFF に出さず、URL も返さない
- 検査の仕組みが動かないときは、`pending` のまま自動で再試行し、`clean` にしない（再試行は §6-2）
- しまった（`quarantined`）ファイルの一覧は owner・admin だけが見られる。中身は開かない。消すことと、誤りだったので戻すこと（理由必須・監査に残す）ができる
- 合格：名前だけ .jpg の別形式は `rejected` になる／実行ファイルの印を持つファイルは `quarantined` になる／`pending` のファイルの URL は、どの口からも取れない

## 8. Secret・PII・監査

### Secret

- 暗号化保存、key rotation、用途分離
- write-only。通常APIは末尾4文字・更新日だけ
- log、error、Slack、release logへ出さない
- outbound先はallowlist、DNS/IP再検査、private address拒否

### PII

- 収集目的、同意、保持、アクセス権を項目ごとに定義
- email/電話検索は暗号化原値＋HMAC検索hash
- CSV/exportはpurpose、件数、条件、期限、download actorを監査
- 本番データをtest送信・fixtureへ使わない

### Audit

- append-only
- before/afterはsecret・大きな本文・PIIを除いた差分
- actor、scope、reason、approval、request/trace、versionを保持
- 保持policy中は一般UIから削除不可

## 9. Metrics契約

- metric definitionに名称、意味、分母、単位、source、owner、version
- event→日別aggregate→dashboard/analysisの一方向
- source recordへ戻れる
- freshnessとlast successful aggregationを表示
- unavailable/partial/staleを0と区別
- small sample privacy threshold
- timezone、currency、unique/totalを明記
- 保存した分析はdefinition version＋結果snapshot
- aggregate再計算は元の業務recordを変更しない

未取得の表示文言は1種に固定する。

| 状態 | 画面の値 | 画面のラベル | API |
|---|---|---|---|
| 取得できていない(理由不明) | `—` | 未取得 | `unavailable` |
| 取得に失敗した | `—` | 取得失敗 | `unavailable` + error code |
| 権限がない | `—` | 権限不足 | 403 |
| 接続していない | `—` | 未接続 | `unavailable` + `not_connected` |
| 一部だけ取得 | 値 | 一部(as_of) | `partial` |
| 古い | 値 | as_of を併記 | `stale` |

「取得できません」「unavailable」を画面文言に使わない。数えて0だったものは`0`と表示し、`—`にしない。

## 10. 工程ゲート

設計との画像比較、実Node ID、対象状態一覧は**工程の条件**であり、各機能の要件の完了条件には含めない。理由は、Pencilの画像書き出しが不安定な期間に「原理的に満たせない完了条件」を32本へ埋め込まないためである。工程ゲートは次で担保する。

- PRテンプレートのVisual Parity欄(対象ルート、Pencilファイル、実Node ID、1920px設計画像、1920px・1440px実装画像、並べて比較した結果)
- `scripts/visual-qa/screens.mjs`を正本とする画面台帳と、V6 の進捗台帳（2026-10-07 にリポジトリから外した）(機械生成)
- 「一致」は文言一致・寸法一致・全状態撮影済みのときだけ。撮れなかった画面は空欄のまま残す
- Pencilを直したら書き出しHTMLを置き直し、その画面の判定を未判定へ戻す

各要件書の完了条件には「設計との画像比較は共通工程ゲート(§10)に従う。要件の完了条件には含めない」の1行だけを置く。

> **2026-10-07**：上の画像比較の工程（V6 の実Node ID・1920px 設計画像・V6 の進捗台帳）は失効した。今の見た目の合格は ★V8 の絵との照合で、条件は `docs/v8-design-rules.md` に従う。「設計との画像比較は要件の完了条件に含めない」という分け方はそのまま残す。

## 11. API応答契約

### 成功

```json
{
  "success": true,
  "data": {},
  "meta": { "requestId": "...", "nextCursor": null, "freshness": "fresh" }
}
```

### 失敗

```json
{
  "success": false,
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "別の人が先に変更しました。最新の内容を確認してください。",
    "requestId": "...",
    "fieldErrors": []
  }
}
```

- 400: JSON/形式不正
- 401: 未認証
- 403: 権限・scope拒否
- 404: scope内に存在しない
- 409: version/状態/在庫競合
- 422: 業務入力不備
- 429: rate/quota
- 202: 非同期受付
- 503: 一時的外部依存失敗。成功扱いにしない

## 12. Observability

> 処理の進みの行・骨組み表示（スケルトン）・保存結果の通知（トースト）の共通部品の動きは §15（2026-09-23 採用）。見た目は ★V8 の板に従う。


- request ID、trace ID、job ID、execution IDを連結
- SLI: receipt遅延、Queue滞留、success/retry/permanent failure、reconcile未解決
- account/provider/event type別。ただし少人数PIIを出さない
- alertは24運用者通知と32運用状態へ
- operator向けerrorは原因と次の行動を表示
- kill switch発動、解除、drift、再開結果を監査

## 13. 完了条件

- scopeなしrepository callを型・testで防ぐ
- 未分類APIが403になる
- published versionを変更できない
- 同一event再送で副作用が重複しない
- retry後も成功済みactionが再実行されない
- kill switchが全dispatcherでserver側強制される
- secretがAPI/log/errorへ出ない
- original mediaをpublic URLで取得できない
- metric unavailableを0にしない
- auditから誰が何を変えたか再現できる
- migration shadow modeで外部送信しない
- 状態を変える操作は「誰が・いつ・何を・理由」を監査に残し、取り消しは逆向きの記録を足す（記録を消さない）
- 権限・範囲・失敗・二重実行を Worker の試験で守り、画面は空・読み込み中・失敗・正常の主な状態を描画の試験で守る。どの試験も、直しを戻すと赤くなることを確かめる

## 14. 実装を分ける単位

1. Scope＋authorization
2. Versioning＋audit
3. Receipt＋domain event
4. Action catalog＋execution＋Queue
5. Runtime gate＋operations status
6. Secret/connectors
7. Media
8. Metrics/read model

各単位を独立PRにし、機能別PRが利用する。全領域を一つの巨大PRにしない。

## 15. 処理の進み・骨組み表示・保存結果の通知（2026-09-23 採用）

管理画面の共通部品の動きの決まり。2026-10-08 に旧「V7 追加要件」（履歴）の E から書き写した。形・位置・色・表示の長さ・動きの速さは ★V8 の板と `docs/v8-design-rules.md` に従い、本節では決めない。お客さまの画面（LIFF）は `docs/v8-requirements/v8-liff.md` に従い、本節を LIFF へ広げない（LIFF の決まりも管理画面へ広げない）。

### 15-1. 処理の進みの行

- 時間のかかる処理（一斉配信の送信、CSV 取込、友だちの一括操作、クロス集計、アップロード）を、同じ部品の1行で見せる
- 並べるもの：対象件数・済み・失敗・経過時間・状態
- 状態：待ち／実行中／一部失敗／完了／停止
- 失敗の件数から失敗の内訳へ移れる。「もう一度」は失敗した分だけ（成功済みを再送しない。§6-2）
- 取れない値は `—`（§9）
- 機能ごとに別々に持っていた進みの表示は、この部品へ置き換える

### 15-2. 骨組み表示（スケルトン）

- 表・カード・詳細の読み込み中は、それぞれの骨組みを出す（`ListState` の読込中）。読み込んだ後に高さが跳ねないようにする
- 「読み込み中」の文字や回転アイコンだけで済ませない

### 15-3. 保存結果の通知（トースト）

- 成功は、短く出して自動で消える。読み上げは `role="status"`
- 失敗は、自動で消さない。理由と「もう一度」を出す。読み上げは `role="alert"`
- 出す場所は、管理画面の全画面で同じ

### 15-4. 動き

- 動きは、状態の変化を伝えるときだけ使う。`prefers-reduced-motion` のときは止める

### 15-5. 合格条件

- 3部品それぞれの全状態（進みの5状態、骨組みの3種、通知の成功・失敗）を自動テストで確認する
- 「もう一度」で成功済みの分が再送されないことを自動テストで確認する
- 空・読込・失敗・権限不足の 4 状態を自動テストで確認する

## 16. データ移行・切り替え・巻き戻しの安全条件

2026-10-08 に旧「データ移行・API・受け入れテスト計画」（2026-08-26・履歴）から、今も守るデータ安全・監査・復旧の条件を書き写した。見た目の照合（V6 の実Node・1920px 画像）は採らず、見た目の合格は `docs/v8-design-rules.md` §3 に従う。DB 更新・配備・顧客への送信の実行許可ではない（各工程は AGENTS.md の承認ゲートに従う）。

### 16-1. 原則

- 旧データは移行元・監査履歴として残し、新しい形へ付け足しで移す。物理削除・列削除・旧 table の削除は、初回の切り替えに含めない（別 Issue・別承認）
- 流れ：棚卸し → 付け足しの schema → dry-run → backfill → shadow 比較 → canary → 読みの切り替え → 書きの切り替え → 見張り → 旧の読みを止める

### 16-2. 機能ごとの移行台帳

旧正本・新正本・ID の対応・件数（全件・アカウント別・状態別）・金額と残高・欠損・重複・変換・外部の副作用・巻き戻し・旧データの保持を、機能ごとに書く。空欄は禁止。未決定は「未決定・決める人・期限」と書く。資料には個人情報・顧客本文・token・URL のクエリを載せず、集計とエラー ID だけにする。

### 16-3. schema・dry-run・backfill

- 新しい table・列・index は付け足し。nullable で足す → backfill → 制約、の順。一意制約の前に重複を隔離する
- 所属（`organization_id`・`line_account_id`）を最初に足す。版・イベント・監査は旧レコードを指せる元キーを持つ
- 金額は最小通貨単位＋通貨。時刻は UTC で保存し、表示の timezone を持つ
- dry-run は、追加・更新・飛ばし・隔離の件数、アカウント別・状態別の内訳、ID の衝突・孤児、金額・残高の新旧差、変換エラーを出す
- backfill は、何度実行しても同じ結果（元 ID＋移行の版で冪等）。区切りから再開・中止できる。1件のエラーで全件を黙って飛ばさない
- backfill・shadow の間は、LINE・ポイント・Webhook・カレンダー・決済を動かさない。旧レコードの「送信済み」を再送しない

### 16-4. shadow・canary・切り替え

- shadow の読みは、同じ入力で旧と新を比べ、件数・ID・状態・金額・日付・集計と分母・権限で見える件数の差を「想定どおり／データの欠陥／実装の欠陥／取得できない」に分ける
- shadow の書きは、新しい側の外部の副作用を止め、本番の送信と混ぜない
- 切り替えは組織・アカウント単位の flag で、内部の試しアカウント → 検証 → 少数の本番の順。読みを先、書きを後。外部の副作用は1種類ずつ
- 旧と新の dispatcher が同時に同じ仕事を持たない（持ち主を1つにする）。巻き戻しの基準は事前に決める
- 切り替えの日は、作業ツリーがクリーンで対象の SHA・migration 番号が一致していること、バックアップと復元の確認、待ちの job と外部の状態の記録を先に済ませる

### 16-5. 巻き戻し

- 読みの flag を旧へ戻し、新しい dispatcher を止め、旧の dispatcher の持ち主を1つだけ再開する
- 切り替え後に新しい側だけに入った書き込みを書き出す
- 外部の送信・ポイント・カレンダー・決済の成功は冪等キーで照合し、二重に実行しない。必要なら補正の記録を足す
- migration で足した table・列は残す。急いで消さない
- 原因・影響したアカウント・件数・補正・再開の条件を記録する。送信済みの LINE は取り消せないので、誤送信は止める・対象を特定する・訂正の方針を人が決める

### 16-6. 受け入れの試験

- API：別組織・別アカウントの ID で取れない（404／403）、未分類の口は拒否、公開版は変えられない、版の不一致は 409、同じ冪等キー・同じ外部イベント ID は1回だけ、成功済みの処理を再実行しない、止めている間は dispatcher が動かない、再開後に古い job を一括で無条件に流さない、秘密値・個人情報がログやエラーに出ない
- データ：新旧の件数（アカウント別・状態別）、元 ID の一対一、孤児 0（または承認済みの隔離件数）、金額・マイル・ポイント・スコアの合計と台帳残高、送信済み・失敗・飛ばしの総数、timezone の境目と月末、履歴から当時の版・金額・内容を再現できること、取れない値が 0 に変わっていないこと
- 金額・残高・支払いは1円の差でも自動で承認しない。件数の差は、分かっている除外の理由ごとに説明できるようにする

### 16-7. 進めない条件

アカウント不明のデータの自動割り当て、金額・残高の差、範囲・安全の試験の失敗、外部の副作用の冪等性が未確認、待ちの job の持ち主が2つ、秘密値・個人情報の露出、作業ツリーが汚れている、巻き戻せない破壊的な migration、のどれかがあれば進めない。反映後の見張り（エラー・待ち行列・重複・範囲外の拒否・金額の差・外部との照合・集計の鮮度）の区切りと旧の読みを残す期間は、反映ごとに決めて記録する。

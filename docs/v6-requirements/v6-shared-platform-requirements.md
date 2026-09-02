# V6 共通基盤 要件定義

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
- `scripts/visual-qa/screens.mjs`を正本とする画面台帳と、`docs/design-qa/v6-progress-ledger.md`(機械生成)
- 「一致」は文言一致・寸法一致・全状態撮影済みのときだけ。撮れなかった画面は空欄のまま残す
- Pencilを直したら書き出しHTMLを置き直し、その画面の判定を未判定へ戻す

各要件書の完了条件には「設計との画像比較は共通工程ゲート(§10)に従う。要件の完了条件には含めない」の1行だけを置く。

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

> 文書：External call executor (A06 / B-365①)｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# External call executor (A06 / B-365①)

仕様の正本は [段2の契約 §3・§4](../../../../../docs/v8-requirements/cleanup-stage2-contract.md#retry)。
共通処理は `index.ts`、予算・待機は `policy.ts`、遮断は `circuit.ts`、HTTP / LINE の単発アダプターは `http.ts` / `line.ts`。
**今回の範囲は口の提供まで。既存サービスは自動ではこの実行器へ移らない。**

## 接続手順

1. 既存の job / outbox に `createCallState(identity, policy, now)` の内容を一度保存する。`operationId`・業務冪等キー・送信者/対象/本文の保存済み snapshot ID・店舗/接続先を固定する。API は最大4回、送信Webhookのみ最大8回/24時間。機能の既存予算が厳しければそれを渡す。`deadlineAt`・`timeoutMs` は既存の期限以下にする。
2. `CallJournal.compareAndSwap` を既存の条件付き更新へ接続する。操作の一意性、所属・snapshot・キー・不変の policy と revision を**保存側**で比較し、1実行者だけを許可する。HTTP の前に `started` を永続化し、結果の更新も CAS にする。メモリだけの journal は本番には使わない。新しい job 名で同じ操作を作り直さない。
3. `CircuitStore` を実行範囲で共有し、`createExternalCall({ circuits })` を作る。`MemoryCircuitStore` は明示的に **1 isolate 内だけ**の実装。店舗・アカウント・接続先・接続 ID の組で分ける。isolate をまたぐ単一 probe / 遮断には、既存の永続状態を使った原子的な acquire / settle と世代チェックを実装して注入する。これを接続せず全 Worker の遮断が完成したとは扱わない。
4. `authorize` で実行直前の権限/所属・店舗の有効設定・同意/ブロック・停止・版・送信上限・静かな時間・遅れ上限を毎回検査する。共通処理はこの判断を代行しない。拒否時は0要求、元の state を返し、呼出側で停止理由を記録する。
5. `execute(signal, identity)` は**物理要求を1回だけ**行い、本文の読み取り・応答解釈まで完了させる。SDK / transport / job の別ループは取り除き、同じ journal の attempts を使う。HTTP アダプターは URL・ヘッダー・シリアライズ済み本文を作成時にコピーする。`maxResponseBytes` は既存上限を必ず渡す。ストリーム・hop ごとの DNS/SSRF 検査・メディア・Response.url 依存は専用アダプターを所有者が作り、既存の制限を保つ。
6. `deferred.nextAt` と理由を既存の予定へ保存して終了する。sleep ループはない。固定1/5/30分は `API_RETRY_WAIT`、既存の指数待ちと jitter は `WaitPolicy` へそのまま渡す。`Retry-After` は絶対時刻の下限で、待機上限や期限で短縮しない。期限を超えるなら `stopped`。
7. `success` は値と `succeeded` を返す。`succeeded` は既に成功済みなので外部を呼ばず、既存の結果を台帳から読む。`unknown` / 保存済み `started` は lease の期限や再起動に関係なく再送しない。参照 ID / 同じキー / 通知台帳で所有者側が照合する。結果保存に失敗した時は durable record が `started` のままでも `unknown` を返す。これを新規要求へ戻さない。

`CallJournal` が false を返すと `conflict`、送信前の保存例外は `storage_error` で0要求。送信後の保存失敗は `unknown`。遮断用ストアが acquire できなければ0要求。settle が失敗した場合、probe の解放は保証しない（安全側で閉じる）。所有者は基盤の保存失敗を監視し、送信再開ではなく照合/回収対象にする。

期限切れの lease を新規送信に流用しない。送信開始前のクラッシュは「送った可能性がある」として予算を予約したまま照合へ回すため、クラッシュ時に実要求より少ない回数で停止する場合がある。回数を増やして補わない。

## 応答の解釈

- 読み取りの 408/429/5xx、通信例外・時間切れは一時失敗。書き込みの同じ障害は既定で **結果不明**。`Idempotency-Key` / `X-Line-Retry-Key` があるだけで再送を許可しない。
- provider の仕様に基づき「副作用なし」を確認できる場合だけ、専用アダプターが `transient` を返す。HTTP アダプターの `rejectedWithoutEffect` はこの証明を持つ経路だけに使う。入力/認証/権限/宛先なしの 4xx は再送不可。HTTP200の Slack `ok:false` 等は `interpret` が分類する。
- 結果不明を同じキーで照合する場合も、provider の重複排除期限内かつその機能の許可内で別の照合手順を使う。この実行器は unknown を自動で取り直さない。保証期限切れも要対応のまま。
- LINE SDK は第2引数 `{ transport }` を追加した（従来の1引数も維持）。全3通信点に適用し、SDK 内では再試行しない。`lineTransport(signal, fetch)` を `execute` の中で注入し、例外は `lineFailure` へ渡す。標準の `fetch` を呼ぶだけの transport を注入し、ここに別の予算つき実行器を重ねない。
- LINE の受理済み 409 は、公式に retry key 対応とされる送信API・同じ retry key が揃う場合だけ成功（この組の409は公式に受理済みを示す）。一般の409は失敗。`x-line-accepted-request-id` があれば元の request ID を優先し、ID がなければ補わない。[LINE公式の再試行仕様](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/) を確認した（2026-10-18 JST）。
- 例外本文・上流本文・statusText・URL・認証情報を診断に含めない。共通実行器はログを出さず、状態に enum の理由・数値 status・回数・次回だけを足す。成功値や identity は業務の保存用であり、そのままログに出さない。

## 所有者への返却

接続表は司令塔の `~/lh-work/design/v8/review/CLEANUP-1017/A06-HANDOFF.md`。
A01/A03/A07/A08/A10 が各サービスを接続する。新 migration、既存サービス・権限・許可先・配備設定の変更は本束にはない。

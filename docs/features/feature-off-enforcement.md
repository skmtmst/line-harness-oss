# 機能オフを API・自動処理へ強制する仕様

対象: V6 機能31「機能設定」／Issue #526  
根拠: `v6-31-feature-settings-requirements-draft.md` §5、§6、§10-3、§15

## 1. 目的と判定順

サイドバーを隠すだけでなく、会社がオフにした機能の管理 API と自動処理を Worker で止める。判定順は認証 → テナント・LINE アカウント範囲 → 機能オフ → 個別入力契約とする。これにより、他社の設定有無を応答差から推測させず、機能オフを入力エラーや契約外と混同しない。

機能オフはデータ削除や緊急停止ではない。保存済みデータと予約行は保持し、再度オンにした時に再開できる状態を保つ。

## 2. 共有カタログ

`packages/shared` に `FEATURE_CATALOG` を置き、`feature_id` の唯一の正本とする。ID は現在の保存キー（例: `broadcasts`、`webinars`、`ec_commerce`）と一致させ、途中で改名しない。各項目は少なくとも次を持つ。

- `featureId`: 変更しない識別子
- `defaultEnabled`: 保存値がない時の既定値
- `required`: 会社設定でオフにできないか
- `bundleId`: 一つのスイッチで扱う単位
- `disablePolicy`: 管理 API・公開 API・自動処理の停止方針

Worker の設定 API、ルート分類、dispatcher はこのカタログから型を参照する。未知の ID は型検査またはテストで失敗させる。

有効状態の読取は一つの共有関数に集約する。版付き一括設定 `feature.settings_bundle_v1` を優先し、値がなければ既存の `feature.<feature_id>`、さらに無ければ `defaultEnabled` を使う。

## 3. ルートの metadata と共通 middleware

全ルートを `FEATURE_ROUTE_MANIFEST` に登録し、HTTP method、Hono の route pattern、分類、LINE アカウント解決方法を宣言する。

```ts
type FeatureRouteMetadata = {
  method: HttpMethod | '*';
  path: string;
  classification:
    | { kind: 'feature'; featureId: FeatureId }
    | { kind: 'core' | 'public' | 'system'; reason: string };
  accountResolver: 'query' | 'body' | 'resource' | 'staff-scope' | 'none';
};
```

機能ルートは `featureId` 必須とし、認証・設定・health・webhook など止めてはいけない経路も `core`、`public`、`system` のいずれかと理由を明記する。広い pattern より固有 pattern を先に評価し、同じ URL に複数定義が一致した場合もテスト失敗とする。

共通 middleware は認証と tenant scope の後、各 route handler の前に一度だけ動く。対象 LINE アカウントは metadata の resolver で決める。query/body は `account_id`、`accountId`、`line_account_id`、`lineAccountId` を同じ規則で読む。resource は URL の ID から所有アカウントを DB で引く。管理 API で必要なアカウントを一意に決められない時は、既定アカウントへ寄せず `400 LINE_ACCOUNT_REQUIRED` とする。

`staff-scope` は複数アカウントを一覧する API に限る。見えるアカウントごとに機能判定し、オフのアカウントのデータを結果から除外する。全対象がオフなら 403 とする。公開経路は認証済み管理 API と同じ middleware を通さず、公開 token または resource から所有アカウントを解決した後、同じ有効判定関数を使う。

## 4. オフ時の応答契約

会社設定がオフなら handler と入力検査を実行せず、次を返す。

```json
{
  "success": false,
  "error": "この機能は設定でオフになっています",
  "code": "FEATURE_DISABLED",
  "featureId": "webinars"
}
```

HTTP status は `403` 固定とする。契約外は別コード `FEATURE_NOT_ENTITLED`、権限不足は既存の認可コード、入力不正は 400/422 のままにする。`featureId` 以外の設定値、他社情報、停止中データ件数は返さない。

管理画面は API で `FEATURE_DISABLED` を受けたら通常のエラー文ではなく、機能がオフであることと機能設定へ戻る導線を持つ 403 画面を表示する。画面側は Codex 所有外のため、#526 では応答契約までを固定し、画面実装は担当票で接続する。

## 5. dispatcher・cron

自動処理も `FEATURE_JOB_MANIFEST` に job 名、`featureId` または `core`、対象アカウントの解決方法を登録する。機能 job はアカウント単位で有効判定してから claim・状態更新・外部送信を行う。オフなら予約行を pending のまま残し、attempt 数や retry 時刻を進めない。

skip 時は監査イベント `feature.execution.skipped`（account、feature、job、時刻、理由のみ）と構造化ログを残す。同じ account・feature・job の反復 cron は日単位で監査を重複させず、件数をログで集約する。再度オンになれば既存の予約を通常の順序で処理する。

job 全体が複数アカウントを走査する場合、サービスへ「有効な account ID 集合」を渡して DB の取得・claim 条件に使う。どれか一社がオフだから job 全体を止める実装は禁止する。

## 6. 未分類を防ぐゲート

CI の契約テストで、実際に mount された `app.routes` と `FEATURE_ROUTE_MANIFEST` を method＋正規化 path で突き合わせる。未分類、存在しない宣言、重複宣言、未知の `featureId` を一件でも検出したら失敗する。dispatcher/cron の実行一覧も `FEATURE_JOB_MANIFEST` と同じ検査を行う。

実行時に管理 API の分類が見つからない場合は fail closed とし、handler を動かさず `500 ROUTE_FEATURE_UNCLASSIFIED` を返して構造化エラーを記録する。`OPTIONS` と not-found は共通基盤として明示的に除外する。

## 7. 完了条件と導入順

1. 共有カタログと二つの manifest を追加し、全 route・job を分類する。
2. 共通 middleware と自動処理 guard を追加する。
3. 代表する各 resolver で、オンなら従来応答、オフなら handler 未実行の 403、契約外・入力不正とのコード分離を契約テストする。
4. オフの予約が claim・送信されず記録され、オンへ戻すと再開することをテストする。
5. 未分類 route/job を加えた時に CI が失敗することをテストする。
6. 管理画面の直接 URL が `FEATURE_DISABLED` を受けて専用 403 画面になることを担当票で確認する。

実装は一度に全 route を middleware 化し、未分類を許した段階移行はしない。既存の個別認可、tenant scope、入力検査は削除しない。

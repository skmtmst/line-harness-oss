# V6 機能10 ウェビナー一覧KPI・通知対象 契約引き継ぎ

- Node: `ZC13r`
- ルート: `/webinars`
- 読み口: `GET /api/webinars/overview?account_id={選択中のLINEアカウントID}`
- 固定base: `codex/kenta-v6-webinar-notifications` `de0848b9`

## 0. `Ho8z4` 通知・リマインド

既存の `GET /api/webinars/:id/notifications` に次を追加した。

```ts
overview.audience = {
  people: number
  bookings: number
  definition: 'active_registrations'
}
```

- `people` は取消済みを除く有効な申込の、重複しない友だち数。
- `bookings` は取消済みを除く申込行数。
- 0は実値0。取得失敗時はこの値を0へせず、取得口全体を失敗にする。
- 設計の184人を固定値で書かず、`overview.audience.people` を表示する。
- `definition` は画面へ内部語のまま出さず、「有効な申込」と説明する。

通常184人・予約191件、空0人・0件、取得失敗の固定データを同梱した。

## 1. 一覧で返す形

```ts
type WebinarOverviewMetric = {
  value: number | null
  state: 'available' | 'unavailable'
  reason: string | null
}

type WebinarOverview = {
  state: 'partial'
  registrationMode: 'people'
  metrics: {
    webinars: WebinarOverviewMetric
    activeWebinars: WebinarOverviewMetric
    registrations: WebinarOverviewMetric
    registrationBookings: WebinarOverviewMetric
    viewers: WebinarOverviewMetric
    viewRate: WebinarOverviewMetric
    averageWatchSeconds: WebinarOverviewMetric
    ctaUniquePeople: WebinarOverviewMetric
    ctaTotalClicks: WebinarOverviewMetric
  }
}
```

`account_id` は必須。選択中のアカウントを見る権限が無い場合は403、未指定は400。
別アカウントと、アーカイブ済みのウェビナーは集計へ混ぜない。

## 2. 数の定義

- `webinars`: アーカイブ済みを除くウェビナー数
- `activeWebinars`: そのうち公開中の数
- `registrations`: 有効な申込の実人数。既定の表示に使う
- `registrationBookings`: 有効な延べ予約数。実人数と混ぜない
- `ctaUniquePeople`: CTAを1回以上押した実人数
- `viewers`: 有効な視聴区間を持つ実人数。区間台帳が無いため現在は未取得
- `viewRate`: `viewers / registrations`。視聴人数を取れないため現在は未取得
- `averageWatchSeconds`: 有効な視聴区間の重複を除いた平均。現在は未取得
- `ctaTotalClicks`: クリック1回ごとの台帳が無いため現在は未取得

`webinar_viewers.last_position_seconds` は最後の再生位置で、実際に見た時間ではない。
視聴人数・率・平均時間へ流用しない。

## 3. 画面での扱い

- `available` かつ `value: 0` は `0人` / `0件`
- `unavailable` かつ `value: null` は `—` と理由
- 申込の主表示は `registrations`。延べ予約へ切り替える場合だけ
  `registrationBookings` を使う
- CTAは `ctaUniquePeople` を「押した人」として表示する
- 設計画像の視聴312人・72.9%を固定値として置かない
- 通常・空・失敗は別の面にする。失敗時に0件や「まだありません」を出さない
- アカウント切替時は前の集計を残さない

## 4. 撮影用固定データ

`scripts/visual-qa/fixtures.mjs` に次の3つを用意した。

- `WEBINAR_OVERVIEW`: 通常。申込428人、CTAを押した人86人、視聴指標は未取得
- `WEBINAR_OVERVIEW_EMPTY`: 実値0。視聴指標は未取得のまま
- `WEBINAR_OVERVIEW_FAILURE`: 読み込み失敗

`mock-api.mjs` は通常状態を `/api/webinars/overview` へ返す。

## 5. 合格条件

1. 選択中アカウントだけを読む
2. 申込の実人数と延べ予約を混ぜない
3. 有効区間の無い視聴指標を0や最後の再生位置から作らない
4. CTAを押した実人数とクリック延べ数を混ぜない
5. 通常・空・失敗・権限不足を別に描く
6. 1440px・1920pxでページと一覧の横スクロール0

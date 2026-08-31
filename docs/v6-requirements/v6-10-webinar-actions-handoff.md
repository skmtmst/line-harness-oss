# V6 機能10 ウェビナー視聴後アクション 契約引き継ぎ

- Node: `Xjk8q`（視聴後通知・アクション）
- ルート: `/webinars/edit?id=…`
- 固定base: #623 head `cd2954bc`
- この契約枝の直前head: `7b2dc2f9`
- 契約枝: `codex/kenta-v6-webinar-contracts-v2`

## 1. 画面が読む口

```ts
GET /api/webinars/:id/actions

{
  settings: Array<{
    trigger: 'completed' | 'cta_click' | 'missed'
    version: number
    action: null | {
      id: string
      name: string
      versionId: string
      versionNumber: number
    }
    updatedAt: string | null
  }>
  availableActions: Array<{
    id: string
    name: string
    versionId: string
    versionNumber: number
  }>
  triggerDefinitions: Array<{
    trigger: 'completed' | 'cta_click' | 'missed'
    label: string
    availability: 'available' | 'estimated'
    definition: string
    limitation: string | null
  }>
}
```

- 選択中のLINE公式アカウントと同じアカウントにある、公開済み共通アクションの現在の公開版だけを候補へ返す。
- 保存後は `versionId` を利用先へ固定する。あとで新版を公開しても勝手に切り替えない。
- 閲覧は owner / admin / staff、保存は owner / admin。
- 別アカウントのウェビナーは404、別アカウントの共通アクション版は422。

## 2. 1つずつ保存する口

```ts
PUT /api/webinars/:id/actions/:trigger

{
  commonActionVersionId: string | null
  expectedVersion: number
}
```

- `trigger` は `completed` / `cta_click` / `missed` の3つ。
- `null` はそのきっかけの設定解除。3つは互いに独立して保存する。
- 版競合は409で、返事の `current` にそのきっかけの最新設定を含める。
- 409では利用先台帳・実行定義を含めて何も書き換えない。
- 画面を開いたときはGETだけを呼ぶ。保存のPUTを自動で呼ばない。

## 3. きっかけの正直な定義

| きっかけ | 状態 | 契約上の意味 |
| --- | --- | --- |
| 視聴完了 | 推定 | 動画の90%地点まで再生位置が進んだ人。実際に見た区間は未接続なので、早送りを除いた完了とは言わない |
| 案内を押した | 取得済み | この回で案内を初めて押した人 |
| 未視聴 | 取得済み | 申込が有効で、翌日の設定時刻（未設定なら10:00）まで視聴記録がない人 |

画面では `availability: 'estimated'` と `limitation` を隠さない。設計の数や、取得していない実績を固定値で置かない。

## 4. 実行と履歴

- 視聴完了のheartbeat、CTAクリック、未視聴の独立した5分処理へ実際に接続済み。
- 未視聴アクションは「見逃し通知」のON/OFFや送信成否に依存しない。
- 実行は既存の自動処理エンジンを通し、`automation_runs` / `automation_run_steps` に残す。
- 同じウェビナー・同じきっかけ・同じ友だち・同じ回は一度だけ開始する。
- 共通アクションが待機・再試行・一部失敗を持つ場合も、既存エンジンの規則をそのまま使う。
- 通知の送信失敗と共通アクションの失敗は互いを成功扱いにせず、片方の失敗で他方の事実を失わない。

## 5. 撮影用固定データ

`scripts/visual-qa/fixtures.mjs` に次を用意した。

- `WEBINAR_ACTION_SETTINGS`: 通常。視聴完了とCTAは設定済み、未視聴は未設定
- `WEBINAR_ACTION_SETTINGS_EMPTY`: 候補0件・3つとも未設定
- `WEBINAR_ACTION_SETTINGS_FAILURE`: 取得失敗
- `WEBINARS`: `/api/webinars` が返す実型どおりの配列1件

`mock-api.mjs` は `/api/webinars/:id/actions` と `/api/webinars/:id` を別の口として返す。文言ではなく `data-qa-open="Xjk8q"` で対象の段を開く。

## 6. Claude側の実装順

1. この契約枝の最新headから画面枝を作る。
2. Claudeが作成済みの一覧KPI・通知対象commit `f4c3f012` を載せる。どちらも同じ機能10を触るため、別々の完成形にしない。
3. `Xjk8q` に3つのきっかけ、定義、公開版の選択、未設定、読込中、取得失敗、権限不足、409再読込を実装する。
4. 3つを独立保存し、1つの失敗で他の選択値を巻き戻さない。
5. 通常・空・失敗・権限不足・409を1440pxと1920pxで比較し、ページと一覧の横スクロール0を確認する。

## 7. 合格条件

1. 候補は同じアカウントの公開版だけで、保存後に新版へ自動追随しない
2. 未設定と取得失敗を混ぜない
3. 視聴完了を実測済みと書かず、推定の限界を表示する
4. 409で窓を閉じず、入力値を保ったまま最新内容を読み直せる
5. 開いただけで書き込みを起こさない
6. 内部ID・内部のきっかけ名・`undefined`・`NaN`・`Invalid Date` を表示しない
7. `data-qa-open="Xjk8q"` を押し口に付ける

## 8. 別件 `GFlD7`

`GFlD7` は契約待ちではない。ローカル枝
`codex/kenta-v6-template-message-length-contract-v2` に既存のPOST / PUTを使った
Unicodeコードポイント5,000字上限がある。

- 固定base: #626 head `7dbf62a5`
- 契約commit: `c02e5960` → `8755ebdc`

画面側はこの2commitを載せ、入力中の残り文字数と422の日本語表示を実装できる。

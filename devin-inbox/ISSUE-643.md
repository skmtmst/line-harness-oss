# Issue #643 予約設定のプレビューが実際のLIFF画面と違う（架空のカレンダー表示）

- ブランチ: `devin/643-liff-preview-truth`
- 取り込んだ `origin/codex/development` の SHA: `0505a05ada59f622f192029eb2e4e2bcfb09b336`（ff-only 取り込み済み）
- **PR: https://github.com/skmtmst/line-harness-oss/pull/652 （Issue題名に `(PR #652)` 追記済み・mergeは行っていない）**
- 完了条件: ①実LIFF構造化 ②実データ反映 ③実React試験で構造一致を証明 — すべて実施済み

## 現状（虚偽プレビュー）の所在

`apps/web/src/app/booking/staff/shifts/page.tsx` の右パネル `<aside>` 内
`<section data-design="Preview">`（1015–1047 行）:

- タイトル「ご希望の日をえらんでください」
- 月〜日の曜日見出し + 14日分の日付マス（`grid-cols-7`）に ○・×・休 マーク
- 凡例（○あいています / ×満席です / 休お休み）＋「○・×は受付上限に対する残数を反映しています。」
- `<details>`「空き枠の内訳を見る」（残り数つき）
- データは `bookingApi.getAvailability`（先頭の有効メニュー・全スタッフ flatMap・14日分）を使っているが、
  描画は実LIFFに存在しないカレンダー形式
- Info バナー（892行）も「右に、お客様のLINEに出るカレンダーがそのまま出ます。」と虚偽の説明

## 実LIFFの構造（`apps/liff/src/components/DateTimePicker.tsx`）

- 「← 戻る」ボタン
- h1「日時を選んでください」＋小文字の ctaLabel（通常時「確認画面で要望を入力してください」）
- 読込中「空き枠を取得中...」、空き0件「この期間に空きはありません。」
- **カレンダー・○×休・凡例・内訳リンクは一切ない**
- `api.availability` の `by_staff[0].slots` を日付でグループ化し、
  空きのある日だけが `<section>`（h2 = `formatJp(date)` → `M/D(曜)`）で縦に並び、
  各日の下に時刻ボタンが `grid grid-cols-4 gap-2` で並ぶだけ
- 取得期間は JST 今日〜+13日（14日分）

## 差分一覧（プレビュー → 実LIFF）

| 項目 | 現プレビュー | 実LIFF |
| --- | --- | --- |
| 見出し | ご希望の日をえらんでください | 日時を選んでください |
| サブ文言 | なし | 確認画面で要望を入力してください（ctaLabel） |
| 戻る導線 | なし | ← 戻る |
| レイアウト | 7列月間カレンダー＋○×休 | 空き日 `<section>` 縦並び＋4列時刻ボタン |
| 日付表記 | 日にち数字＋マーク | `M/D(曜)` |
| 凡例・内訳 | あり | なし |
| 空きなし文言 | なし（×表示） | この期間に空きはありません。 |
| 対象データ | 全スタッフの枠を合算 | `by_staff[0]`（= StaffList 先頭の担当） |
| 期間起点 | UTC 今日 | JST 今日 |

## 対応方針

- 新規 `liff-preview.tsx` に実LIFF構造のプレビュー部品を作り、page.tsx の Preview 節を置き換え
- `by_staff[0]`（LIFF StaffList と同じ並び: is_designation_optional DESC, sort_order ASC）の枠を表示対象にし、
  カード外に「どのメニュー・担当の画面か」の注記を添える（実データ反映・推測でない）
- 取得期間を JST 今日〜+13日にそろえる
- Info バナーの「カレンダー」文言を実態に修正
- `apps/web/src/lib/design-structure.json` の parts「ご希望の日をえらんでください」を実文言へ更新（契約テスト整合のため）
- `apps/liff` は読み取り専用・変更なし
- `docs/design-qa` / `docs/design-reference` の tksPc.txt にも旧文言が残るが、Claude 所有領域のため変更せず、設計側の修正は別途依頼が必要（未解決に記録）

## 変更

- `apps/web/src/app/booking/staff/shifts/liff-preview.tsx`（新規）: 実LIFF構造のプレビュー部品。
  「← 戻る」「日時を選んでください」「確認画面で要望を入力してください」＋
  空き日 `<section>` 縦並び（見出し `M/D(曜)`＝liff formatJp 同形）＋時刻ボタン `grid-cols-4`。
  取得中「空き枠を取得中...」・空き0件「この期間に空きはありません。」・取得失敗の案内を実LIFF相当で出す。
  カード外に「どのメニュー・担当の画面か」の注記を添える。
- `apps/web/src/app/booking/staff/shifts/page.tsx`: 架空カレンダー（7列・○×休・凡例・内訳details）を撤去し
  `<section data-design="Preview">` 内を `LiffDateTimePreview` に置き換え。空き枠は `by_staff[0]`
  （LIFF StaffList と同じ並びの先頭担当）のみ使用。取得期間を UTC→JST 今日〜+13日に修正。
  Infoバナー「カレンダーがそのまま出ます」→「日時の選び方がそのまま出ます」。
  不要になった `PreviewMark`/`slotDates`/旧 `preview` メモ/`previewError` を削除。
- `apps/web/src/app/booking/staff/shifts/page.test.ts`: 旧カレンダー文言の契約を
  実LIFF文言・構造の契約へ更新（`liff-preview.tsx` も読んで検査）。
- `apps/web/src/app/booking/staff/shifts/liff-preview-structure-react.test.tsx`（新規）:
  実React描画で構造一致を証明＋LIFF側ソースの文言・`grid-cols-4`・`grid-cols-7`不在を契約化（LIFF変更時のドリフト検知）。
- `apps/web/src/lib/design-structure.json`: parts「ご希望の日をえらんでください」→「日時を選んでください」。
- `apps/web/design/design-debt-baseline.json`: LIFF画面再現の直書き時刻ボタン（意図的・共通Button不使用）を1件だけ追記。
- `docs/release-log/unreleased/652-kenta-予約プレビューを実物どおりにした.md`: 採番後に #652 を追記済み。

## 検証

- `pnpm test`（apps/web・NEXT_PUBLIC_API_URL=stg設定）: 850ファイル / 6091件 全PASS
- `pnpm typecheck`: PASS
- `pnpm build`: PASS
- 新規React試験8件: 実文言・日付セクション縦並び・4列時刻ボタン・空/取得中/失敗表示・架空部品の不在を確認
- `design-structure`/`design-debt`/`page.test.ts`/`page.react.test.tsx` 既存契約: PASS

## 未解決

- Pencil正本（★V6 28-1-A）と `docs/design-qa`・`docs/design-reference` の tksPc.txt には
  旧カレンダー見本の記述が残る。Claude所有領域のため本PRでは未変更。設計側の修正は別途依頼が必要。
- プレビューは担当一覧の先頭担当（by_staff[0]）の画面を再現。他担当を選んだ場合の枠は
  実LIFFでも担当ごとに切り替わるため、注記で対象担当を明示している。

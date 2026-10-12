# flake3: React の試験環境破棄との競合

## 原因と再現

- 開始SHA: `38754102ce`。検証前に本線 `4aea06f85e` を取り込んだ（fast-forward、競合なし）。
- 元の `apps/web/src/app/booking/staff/shifts/button-accessible-names.test.tsx` 116行で `render` した根を、試験後に `cleanup` / `unmount` していなかった。Vitest は `globals: false` のため、Testing Library の `typeof afterEach === 'function'` による自動片づけが登録されない。
- 117〜120行は外側の `section` と固定50msを待つだけで、別々に動的 import される営業時間タブ・右の写しと、設備・空き枠の非同期更新の完了を保証しなかった。APIの見本は即時応答だが、後続の描画は別の仕事になる。
- 同じボタン検査の補助関数を使うファイルは4件。対象以外の3件はすでに片づけがある。補助関数自身はDOMを読むだけで、根もタイマーも作らない。
- 通常の修正前30回は成功・Unhandled Errors 0。自然発生のCI競合は手元では再現しなかった。
- 故障注入では `getAvailability` の応答を保留し、試験終了後に解決してから、Vitestの環境破棄と同じように `window` を外した。根が残っている元の試験は、試験のassert成功後に React scheduler の `performWorkUntilDeadline` → `performWorkOnRootViaSchedulerTask` で `ReferenceError: window is not defined` が1件発生した。
- 同じ注入条件で先に `await act(async () => cleanup())` を実行すると根は残らず、Unhandled Errors 0。製品の空き枠effectにはunmount時のキャンセルがすでにある（`settings.tsx` 276〜294行）。試験側の根の片づけ不足を原因と判断した。
- 元の固定50msタイマー自体はawaitされており、未処理のfetch拒否や持続タイマーは対象で見つからなかった。修正では固定待ちを除き、試験設定でエラーを無視したり、待つ上限を増やしたりしていない。

## 修正と仲間

- 対象は営業時間の見出し・設備の空状態・右の写しの空き状態を待ってから名前を調べ、`afterEach` で `await act(async () => cleanup())` する。
- webの全2,164試験ファイルを構文でも点検した。実際に根を作る1,194ファイル（Testing Library 649＋直接の根545）を、Testing Library の `render` / `renderHook` と直接の `createRoot` ごとに調べた。片づけのないものは15ファイル（対象を含むRTL 12件＋直接の根3件、対象の仲間は14件）。30件以下なのでファイルごとに直した。修正後、片づけ呼び出しのないファイルは0件。試験内で直接unmountする2ファイルも中身を確認した。
- 直接の根は記録して、`act` 内で全てunmountした後にhostを外す。DOMの空文字代入やhostの削除だけでは根の片づけにならない。
- hookの試験は偽タイマーを本物に戻す前、fetchの見本を解除する前に片づける。
- 画面・API・Workerの製品コードは変更していない。

Testing Libraryの12件:

- `apps/web/src/app/accounts/uid-file-race.test.tsx`
- `apps/web/src/app/booking/staff/shifts/button-accessible-names.test.tsx`
- `apps/web/src/app/nen/health/weight-bars.test.tsx`
- `apps/web/src/app/webinars/edit/webinar-edit-compare-dialog.test.tsx`
- `apps/web/src/app/webinars/edit/webinar-edit-conflict-band.test.tsx`
- `apps/web/src/components/rich-menus/rich-menu-template-preview.test.tsx`
- `apps/web/src/components/shared/file-drop-input-contract.test.tsx`
- `apps/web/src/components/shared/status-words.test.tsx`
- `apps/web/src/components/ui/list-range-react.test.tsx`
- `apps/web/src/lib/size-scale-contract.test.tsx`
- `apps/web/src/lib/use-live-reorder.react.test.tsx`
- `apps/web/src/lib/use-row-leaving.test.ts`

直接の根の3件:

- `apps/web/src/app/booking/bookings/booking-detail-v8.react.test.tsx`
- `apps/web/src/components/ops/impersonation-bar-v8.react.test.tsx`
- `apps/web/src/lib/use-same-page-url.test.tsx`

## 検証

- 修正前: 対象30/30成功、Unhandled Errors 0（前回の実行記録を引き継いだ）。
- 修正後: 対象30/30成功、Unhandled Errors 0。
- 共通条件: `NEXT_PUBLIC_API_URL=http://127.0.0.1:8788`、`--maxWorkers=4 --minWorkers=1`。
- 繰り返し命令: `pnpm --filter web exec vitest run --config vitest.config.ts src/app/booking/staff/shifts/button-accessible-names.test.tsx --maxWorkers=4 --minWorkers=1` を30回。
- web全体命令: `NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web run test --maxWorkers=4 --minWorkers=1`。
- 型検査: `NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web typecheck` 成功。
- 全体1回目: 2,164ファイル中2,162成功、12,801件成功・3件失敗・1件skip・1件todo、Unhandled Errors 0。`update-client.test.ts` の2件は `@line-harness/update-engine/pure` の生成物が無かった。CIの前提と合わせて `pnpm --filter @line-harness/update-engine build` し、解消した。
- 残り1件は既存 `webinar-list-behavior.test.tsx:95` の検索中表示。API呼び出しを待った直後に表示を同期取得して失敗した。このファイルは変更していない。生成後に失敗2ファイルだけを同条件で再実行し、11/11成功を確認（`recheck.log`）。
- web全体2回目: 2,164/2,164ファイル成功、12,804件成功・1件skip・1件todo、Unhandled Errors 0。既存のskip・todoは変えていない。
- `git diff --check` 成功。試験15ファイルと今回の報告・反映履歴だけをコミットし、作業ツリーをクリーンにする。
- 手元の証拠: `/tmp/lh-flake3-1012/` の `before/summary.json`、`after/summary.json`、`probe-before.log`、`probe-after.log`、`teardown-probe-fixed.test.tsx`、`audit-before.json`、`audit-current.json`、`audit-ast-before.json`、`audit-ast-final.json`、`web-all.log`、`web-all-final.log`、`typecheck.log`。故障注入の `window` 削除は実験だけで、通常試験には追加していない。
- push・PR作成・DB更新・配備は実施しない。反映履歴の `#0000` は司令塔が採番後に置き換える。

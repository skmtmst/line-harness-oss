## 修正

- `packages/db/vitest.config.ts` / `apps/worker/vitest.config.ts` の include 漏れで Required gate を1回も通っていなかった `scenario-resolve.test.ts`・`scenario-schedule.test.ts`・`common-vars-account-scope-archive.test.ts`・`inject-version.test.ts` を繋いだ。`scenario-resolve.test.ts` は PR #177 で撤回済みの carousel→flex coerce を期待したままだったため修正し、`scenario-schedule.test.ts` は呼び出し元の shifted frame 規約に合わせて実装・試験フィクスチャをUTC明示メソッドへ統一した @muse #1563 2026-09-10 14:50

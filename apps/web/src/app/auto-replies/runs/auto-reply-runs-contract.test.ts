import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(new URL('../../../v8/auto-replies/runs.tsx', import.meta.url), 'utf8')
const worker = readFileSync(join(here, '../../../../../worker/src/routes/auto-reply-runs.ts'), 'utf8')

describe("管理画面 自動応答・実行結果 t7UtYQ", () => {
  it('未取得と実値0を同じ表示にしない', () => {
    expect(page).toContain("value={data ? data.summary.monthHits : null}")
    expect(page).toContain("const failedCount = data?.summary.errors")
    expect(page).toContain("data?.summary.averageResponseMs == null")
  })

  it('失敗・空・読込を別の状態として表示する', () => {
    expect(page).toContain('<ListState kind="loading"')
    expect(page).toContain('<ListState kind="error"')
    expect(page).toContain('<ListState kind="empty"')
  })

  it('失敗と何もしなかった記録を別の状態として返す', () => {
    /*
      **「失敗した」と「何もしなかった」を同じ状態にしない。**
      失敗は直して送り直す話、見送りは条件に合わなかっただけで直すものが無い。
      口が返す状態は途中で `partial_failed` が増えたので、そこも失敗に寄せる。
    */
    expect(worker).toContain("if (status === 'reply_failed' || status === 'partial_failed' || status === 'failed')")
    expect(worker).toContain("return 'permanent_failed'")
    expect(worker).toContain("if (status === 'skipped') return 'skipped'")
    /* 見送りは、なぜ送らなかったかを運用の言葉で言う。 */
    expect(worker).toContain("何もしませんでした")
  })

  it('知らない状態が来ても白い画面にしない', () => {
    expect(page).toContain('function statusView(')
    expect(page).not.toContain('STATUS[item.status]')
  })
})

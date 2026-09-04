import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, 'page.tsx'), 'utf8')
const css = readFileSync(join(here, 'auto-reply-runs.module.css'), 'utf8')
const worker = readFileSync(join(here, '../../../../../worker/src/routes/auto-reply-runs.ts'), 'utf8')
const service = readFileSync(join(here, '../../../../../worker/src/services/auto-reply.ts'), 'utf8')

describe('V6 自動応答・実行結果 t7UtYQ', () => {
  it('Pencilの実Nodeと共通部品を正本にする', () => {
    expect(page).toContain('data-design-node="t7UtYQ"')
    for (const component of ['SummaryCard', 'Card', 'ListState', 'Pagination', 'StatusBadge', 'StickyBar']) {
      expect(page).toContain(component)
    }
    expect(page).toContain('usePageTitle')
  })

  it('未取得と実値0を同じ表示にしない', () => {
    expect(page).toContain("value={data?.summary.monthHits ?? null}")
    expect(page).toContain("value={data?.summary.errors ?? null}")
    expect(page).toContain("data?.summary.averageResponseMs === null")
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

  it('同じWebhookイベントを先に確保してから返信する', () => {
    expect(service.indexOf('reserveAutoReplyEvaluation')).toBeLessThan(
      service.indexOf('replyMessageWithRequestId'),
    )
    expect(service).toContain('if (!reservation.created)')
    expect(service).toContain('recordAutoReplyHit')
  })

  it('1440pxで右390pxを残しても一覧を横へはみ出させない', () => {
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) 390px')
    expect(css).toContain('grid-template-columns: 34px minmax(160px, 1fr)')
    expect(css).not.toContain('overflow-x: auto')
  })
})

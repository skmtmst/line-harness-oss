import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 表の幅の見張り（m15c）。
 *
 * 共通の表は table-fixed のため、列幅の指定どおりに器へ収まる。
 * 逆に言うと、列幅の指定を誤るとそのままはみ出し・右空きになる。
 * 司令塔の見た目点検（1440px・表の左右の余白）で出た4件を守る。
 *
 * 決まり：最後の列（操作・状態）は中身に合わせた固定幅にし、
 * 割合の列だけでは 100% を超えない。残りは幅を指定しない列が吸う。
 * 直しを割合へ戻すと、この試験が赤くなる。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function read(relativePath: string): string {
  return readFileSync(join(HERE, relativePath), 'utf8')
}

/** `width: '12%'` のような割合指定を全部拾って合計する。 */
function percentTotal(source: string): number {
  const values = [...source.matchAll(/width:\s*['"](\d+(?:\.\d+)?)%['"]/g)].map((m) =>
    Number(m[1]),
  )
  return values.reduce((sum, value) => sum + value, 0)
}

describe('表は器の幅にぴったり収める', () => {
  it('/booking/menus: 操作列は固定幅で、中身が器からはみ出さない', () => {
    const page = read('booking/menus/page.tsx')
    expect(page).toContain('<DataTable')
    // 操作列は 3ボタン（約178px）に合わせた固定幅。割合（22%）に戻さない。
    expect(page).toMatch(/<Th[^>]*w-48[^>]*>操作<\/Th>/)
    expect(page).not.toMatch(/width:\s*['"]22%['"]/)
    // 割合の合計は 100% 未満。残りは「だれが受けられるか」（自動）が吸う。
    expect(percentTotal(page)).toBeLessThan(100)
  })

  it('/events: 操作列は固定幅で、中身が器からはみ出さない', () => {
    const page = read('events/page.tsx')
    expect(page).toContain('<DataTable')
    // 操作列は 2ボタン（約242px）に合わせた固定幅。割合（14%）に戻さない。
    expect(page).toMatch(/<Th[^>]*w-64[^>]*>操作<\/Th>/)
    expect(page).not.toMatch(/width:\s*['"]14%['"]/)
    expect(percentTotal(page)).toBeLessThan(100)
  })

  it('/booking/staff: 操作列は固定幅で、右に大きく空けない', () => {
    const page = read('booking/staff/page.tsx')
    expect(page).toContain('<DataTable')
    // 操作列は「編集＋…」（約118px）に合わせた固定幅。割合（24%）に戻さない。
    expect(page).toMatch(/<Th[^>]*w-32[^>]*>操作<\/Th>/)
    expect(page).not.toMatch(/width:\s*['"]24%['"]/)
    expect(percentTotal(page)).toBeLessThan(100)
  })

  it('/（対応が必要な受信）: 状態列は札に合わせた固定幅で、右に空けない', () => {
    const card = read('../components/support/pending-inbox-card.tsx')
    expect(card).toContain('<DataTable')
    // 状態の札（約52px＋余白）に合わせた 80px。96px に戻さない。
    expect(card).toMatch(/<Th[^>]*width:\s*80[^>]*>状態<\/Th>/)
    expect(card).not.toMatch(/width:\s*96/)
    expect(percentTotal(card)).toBeLessThan(100)
  })
})

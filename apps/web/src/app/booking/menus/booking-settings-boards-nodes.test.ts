import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SETTINGS = readFileSync(join(HERE, 'settings-v8.tsx'), 'utf8')

/*
 * 予約設定の残りの板（メニュー1152・メニュー閲覧のみ・受付枠1152）は
 * `data-design-node` が無いと進み具合に数えられない。
 * 状態（`xCoDe`）とメニュー編集の競合（`v5L19Z`）は別レーン済み。
 * 見た目の部品は既存のものを使い、ここでは板IDの結び付けだけを見る。
 */
describe('予約設定の残りの板ID', () => {
  it('狭い幅でメニューが P6EdLW・受付枠が VFxWU になる', () => {
    expect(SETTINGS).toContain('useNarrowViewport()')
    expect(SETTINGS).toContain("narrow && tab === 'menus' ? 'P6EdLW'")
    expect(SETTINGS).toContain("narrow && tab === 'hours' ? 'VFxWU'")
  })

  it('メニューを見るだけの人に C9fv7A の帯が出る', () => {
    expect(SETTINGS).toContain("data-design-node={tab === 'menus' && !canEditMenus ? 'C9fv7A' : tabNode}")
    expect(SETTINGS).toContain('閲覧のみで見ています。変える操作は管理者に頼んでください。')
  })
})

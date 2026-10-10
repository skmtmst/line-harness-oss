import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error JS tool
import { mainLandmarkOffenders } from '../../apps/web/scripts/single-main-landmark.mjs'
// @ts-expect-error JS tool
import { countScreenCss } from '../../apps/web/scripts/screen-css-budget.mjs'
const dirs: string[] = []
function fixture() {
  const src = mkdtempSync(join(tmpdir(), 'preqa-v8-guard-')); dirs.push(src)
  for (const path of ['app', 'components', 'v8', 'v8/login']) mkdirSync(join(src, path), { recursive: true })
  return src
}
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })))
describe('ROOT-23 V8を見張る道具の判別力', () => {
  it('V8の画面に増えた本文を改行したJSXでも検出する', () => {
    const src = fixture()
    writeFileSync(join(src, 'v8', 'bad.tsx'), '<main\n className="bad">本文</main>')
    writeFileSync(join(src, 'v8/login/good.tsx'), '<main>独立したログイン</main>')
    writeFileSync(join(src, 'v8', 'bad.test.tsx'), '<main>試験</main>')
    expect(mainLandmarkOffenders(src)).toEqual(['v8/bad.tsx'])
  })
  it('V8の余白・高さ・文字を実際に数え、型の変数と共通部品は除く', () => {
    const src = fixture()
    writeFileSync(join(src, 'v8', 'bad.module.css'), '.bad { margin: 3px; height: 4px; font-size: 5px; padding: var(--tpl-pad); }')
    writeFileSync(join(src, 'components', 'shared.module.css'), '.shared { margin: 3px; }')
    expect(countScreenCss(src)).toEqual({ 'v8/bad.module.css': { spacing: 1, height: 1, font: 1 } })
  })
})

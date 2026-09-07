import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..', '..', '..', '..')
const banner = readFileSync(join(import.meta.dirname, 'update-banner.tsx'), 'utf8')
const capture = readFileSync(join(root, 'scripts/visual-qa/capture-screens.mjs'), 'utf8')

describe('更新告知と画面撮影', () => {
  it('撮影器の一時印がある場合だけ更新告知の取得を始めない', () => {
    expect(capture).toContain("sessionStorage.setItem('lh_visual_qa_capture', '1')")
    expect(banner).toContain("sessionStorage.getItem('lh_visual_qa_capture') === '1'")
    expect(banner.indexOf("sessionStorage.getItem('lh_visual_qa_capture')"))
      .toBeLessThan(banner.indexOf('if (!updateBannerEnabled) return'))
  })
})

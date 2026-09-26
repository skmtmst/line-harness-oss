import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HQ_MENU_SECTIONS } from '@/lib/menu'

const sidebar = readFileSync(new URL('../../components/layout/sidebar.tsx', import.meta.url), 'utf8')
const sharedTemplatePage = readFileSync(new URL('./hq-template-page.tsx', import.meta.url), 'utf8')
const formSubmissions = readFileSync(new URL('./form-submissions/page.tsx', import.meta.url), 'utf8')
const friendAttributes = readFileSync(new URL('./friend-attributes/page.tsx', import.meta.url), 'utf8')
const richMenus = readFileSync(new URL('./rich-menus/page.tsx', import.meta.url), 'utf8')

const UNAVAILABLE_HREFS = [
  '/hq/friend-attributes',
  '/hq/templates',
  '/hq/rich-menus',
  '/hq/form-submissions',
] as const

/**
 * m13k: 配布の受け口が無いあいだ、統括の4画面は「まだ使えません」だけの
 * ページになる。押しても何もできない入口を置かないよう、メニューからは
 * 外す。ページ自体は残し、直接URLでは「アカウントを選ぶ」へ案内する。
 */
describe('統括の「まだ使えません」画面の整理', () => {
  it('配布が無効のあいだ4画面をサイドバーに出さない', () => {
    for (const href of UNAVAILABLE_HREFS) {
      expect(sidebar).toContain(`'${href}'`)
    }
    // フラグが有効になれば再表示する（一時的な除外であり削除ではない）。
    expect(sidebar).toContain('!HQ_TEMPLATE_DISTRIBUTION_ENABLED')
  })

  it('メニューの定義には4項目を残す（有効化で復帰・直接URLは維持）', () => {
    const hrefs = HQ_MENU_SECTIONS.flatMap((section) => section.items).map((item) => item.href)
    for (const href of UNAVAILABLE_HREFS) {
      expect(hrefs).toContain(href)
    }
  })

  it('直接開いたときは案内のまま「アカウントを選ぶ」へ誘導する', () => {
    expect(sharedTemplatePage).toContain('TargetMissing')
    expect(sharedTemplatePage).toContain('まだ使えません')
    expect(sharedTemplatePage).toContain('hqOpenHref(target)')
    expect(sharedTemplatePage).toContain('アカウントを選ぶ')
  })

  it('4画面とも共通の案内ページを使い回す', () => {
    expect(formSubmissions).toContain('HqTemplatePage')
    expect(friendAttributes).toContain('HqTemplatePage')
    expect(richMenus).toContain('HqTemplatePage')
  })
})

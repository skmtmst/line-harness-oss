import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HQ_MENU_SECTIONS } from '@/lib/menu'

const sidebar = readFileSync(new URL('../../components/layout/sidebar.tsx', import.meta.url), 'utf8')
const sharedTemplatePage = readFileSync(new URL('./form-submissions/page.tsx', import.meta.url), 'utf8')
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
  it('現役の配布画面の入口を旧テーマの旗で隠さない', () => {
    expect(sidebar).toContain('isHq ? HQ_MENU_SECTIONS')
    expect(sidebar).not.toContain('HQ_TEMPLATE_DISTRIBUTION_ENABLED')
    expect(sidebar).not.toContain('HQ_UNAVAILABLE_DISTRIBUTION_HREFS')
  })

  it('メニューの定義には4項目を残す（有効化で復帰・直接URLは維持）', () => {
    const hrefs = HQ_MENU_SECTIONS.flatMap((section) => section.items).map((item) => item.href)
    for (const href of UNAVAILABLE_HREFS) {
      expect(hrefs).toContain(href)
    }
  })

  it('直接URLはV8のひな形画面へ通す', () => {
    expect(sharedTemplatePage).toContain('<HqTemplatesV8 type=\"form\"')
    expect(sharedTemplatePage).not.toContain('TargetMissing')
  })
  it('各入口はV8の機能画面を使う', () => {
    expect(formSubmissions).toContain('HqTemplatesV8')
    expect(friendAttributes).toContain('HqTemplatesV8')
    expect(richMenus).toContain('HqTemplatesV8')
  })
})

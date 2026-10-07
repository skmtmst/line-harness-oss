import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CreatePage } from './create-page'

/*
 * ★V8 の作る画面の競合（pvimJ）は、同時編集の知らせを板の頭のすぐ下に、
 * 入力欄と右の列の両方にまたがる幅（左右 24・上下 12）で置く。型にその置き場を用意する（2026-10-07）。
 */
const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'page-templates.module.css'), 'utf8')
const globals = readFileSync(join(here, '../../app/globals.css'), 'utf8')

describe('作る型：板いっぱいの帯の置き場', () => {
  it('notice は板の頭の後ろ・本文（左右の列）の前に、本文の外で置く', () => {
    const html = renderToStaticMarkup(
      <CreatePage title="CTA・フォーム" footerActions={<button type="button">保存</button>} preview={<p>右の列</p>} notice={<p>ほかの人が保存しました</p>}>
        <p>入力欄</p>
      </CreatePage>,
    )
    const notice = html.indexOf('data-template-region="notice"')
    expect(notice).toBeGreaterThan(html.indexOf('data-template-region="heading"'))
    expect(notice).toBeLessThan(html.indexOf('data-template-region="body"'))
  })

  it('渡さなければ置き場も出ない', () => {
    const html = renderToStaticMarkup(<CreatePage title="作る" footerActions={null}><p>入力欄</p></CreatePage>)
    expect(html).not.toContain('data-template-region="notice"')
  })

  it('V8 の余白は変数で持つ（上下 12・左右 24）', () => {
    expect(css).toMatch(/\.createNotice \{ padding: var\(--tpl-create-notice-pad\); \}/)
    expect(globals).toMatch(/--tpl-create-notice-pad: 12px 24px;/)
  })
})

describe('行の「…」のメニュー：区切りの余白', () => {
  it('V8 では区切りの上下に余白を足さない（SkY9V：項目の並び 36 に線と間で 3 だけ）', () => {
    const menuCss = readFileSync(join(here, '../shared/action-menu.module.css'), 'utf8')
    expect(menuCss).toMatch(/\[data-theme="v8"\] \.divider \{\s*margin: var\(--tpl-menu-divider-margin\);/)
    expect(globals).toMatch(/--tpl-menu-divider-margin: 0;/)
  })
})

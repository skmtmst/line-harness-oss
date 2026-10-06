import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Dialog from './dialog'

/*
 * ★V8 の窓の絵は、幅が 480〜720・上からの位置が 180〜380 と板ごとにばらばら（2026-10-06 に 39 枚を数えた）。
 * 共通の窓を1つの形に固めず、画面が絵の値（designWidth・designTop）を渡せるようにする。
 * 渡さない画面は今までどおり。
 */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'dialog.module.css'), 'utf8')
const render = (props: Partial<React.ComponentProps<typeof Dialog>>) => renderToStaticMarkup(
  <Dialog open modal={false} title="「秋のセミナー」をアーカイブする" onCancel={vi.fn()} onConfirm={vi.fn()} confirmLabel="アーカイブする" {...props} />,
)

describe('V8 の窓：絵の幅を画面が渡せる', () => {
  it('designWidth を渡すと、面にその幅が乗る', () => {
    const html = render({ designWidth: 600 })
    expect(html).toContain('data-design-width=""')
    expect(html).toContain('--dialog-design-width:600px')
    expect(css).toMatch(/\[data-theme='v8'\] \.panel\[data-design-width\] \{\s*width: min\(var\(--dialog-design-width\), 100%\);/)
    // 層（@layer components）の外で、「幅 560」「大きい窓 800」の規則より後ろに置く（前に置くと負けて効かない）。
    expect(css.indexOf("[data-theme='v8'] .panel[data-design-width]")).toBeGreaterThan(css.indexOf("[data-theme='v8'] .panel[data-size='large']"))
  })

  it('渡さなければ今までどおり（幅の印も付かない）', () => {
    const html = render({})
    expect(html).not.toContain('data-design-width')
    expect(html).not.toContain('--dialog-design-width')
  })

  it('上からの位置は背景（overlay）で受ける', () => {
    expect(css).toMatch(/\[data-theme='v8'\] \.overlay\[data-design-top\] \{\s*align-items: flex-start;\s*padding-top: var\(--dialog-design-top\);/)
  })
})

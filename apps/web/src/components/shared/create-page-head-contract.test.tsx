import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

import CreatePage from './create-page'

const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, 'create-page.module.css'), 'utf8')

/*
 * 作成画面の頭を作る画面の絵（d9xoI・w9zY5）に寄せる。
 * 絵の板の頭は「内側 20/24/16・戻る13・題22・説明12・下に線」の縦並び。
 * 既定（v7）の頭は変えない。上書きは [data-theme="v8"] だけ。
 */
describe('作る型の頭（v8・作成画面の絵）', () => {
  it('戻る行は頭の内側（題の上）', () => {
    const html = renderToStaticMarkup(
      <CreatePage title="試しの作成" parent={['一覧', '/items']} onSave={async () => {}}>
        <p>中身</p>
      </CreatePage>,
    )
    expect(html).toMatch(/data-design="Head"[^>]*>[\s\S]*?<nav data-design="Crumb"/)
  })

  it('頭なしでは戻る行だけ外に出る（v7 と同じ）', () => {
    const html = renderToStaticMarkup(
      <CreatePage title="試しの作成" parent={['一覧', '/items']} onSave={async () => {}} showHeader={false}>
        <p>中身</p>
      </CreatePage>,
    )
    expect(html).toContain('data-design="Crumb"')
    expect(html).not.toContain('data-design="Head"')
  })

  it('v8 の頭は内側 20/24/16・縦並び gap 6・下に線', () => {
    const rule = css.match(/\[data-theme="v8"\]\s*\.head\s*{[^}]*}/s)
    expect(rule, 'v8 の頭の指定がありません').toBeTruthy()
    expect(rule![0]).toMatch(/padding:\s*20px 24px 16px/)
    expect(rule![0]).toMatch(/gap:\s*6px/)
    expect(rule![0]).toMatch(/border-bottom:\s*1px solid var\(--color-hairline\)/)
  })

  it('v8 の頭は Header の高さ76・下余白を使わない（題22/700・説明12/500・行の高さは通常）', () => {
    const header = css.match(/\[data-theme="v8"\]\s*\.head\s*>\s*header\s*{[^}]*}/s)
    expect(header, 'v8 の header リセットがありません').toBeTruthy()
    expect(header![0]).toMatch(/min-height:\s*0/)
    expect(header![0]).toMatch(/margin-bottom:\s*0/)
    expect(css).toMatch(/\[data-theme="v8"\]\s*\.head h1\s*{[^}]*font-size:\s*22px/s)
    expect(css).toMatch(/\[data-theme="v8"\]\s*\.head h1\s*{[^}]*font-weight:\s*700/s)
    expect(css).toMatch(/\[data-theme="v8"\]\s*\.head h1\s*{[^}]*line-height:\s*normal/s)
    expect(css).toMatch(/\[data-theme="v8"\]\s*\.head p\s*{[^}]*font-size:\s*12px/s)
    expect(css).toMatch(/\[data-theme="v8"\]\s*\.head p\s*{[^}]*font-weight:\s*500/s)
    expect(css).toMatch(/\[data-theme="v8"\]\s*\.head p\s*{[^}]*line-height:\s*normal/s)
  })

  it('v8 では戻る行（← 親へ）を描かない（オーナー 2026-10-08。戻るのは上の帯のパンくずと［キャンセル］）', () => {
    const previous = process.env.NEXT_PUBLIC_ADMIN_THEME
    process.env.NEXT_PUBLIC_ADMIN_THEME = 'v8'
    try {
      const html = renderToStaticMarkup(
        <CreatePage title="試しの作成" parent={['一覧', '/items']} onSave={async () => {}}>
          <p>中身</p>
        </CreatePage>,
      )
      expect(html).not.toContain('data-design="Crumb"')
      expect(html).toContain('試しの作成')
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_ADMIN_THEME
      else process.env.NEXT_PUBLIC_ADMIN_THEME = previous
    }
    expect(css).not.toMatch(/\[data-theme="v8"\]\s*\.crumb/)
  })

  it('既定（v7）の指定は空・Header 本体は触らない', () => {
    expect(css).toMatch(/\.head\s*{\s*}/)
    expect(css).toMatch(/\.crumb\s*{\s*}/)
    expect(css).not.toMatch(/min-height:\s*76px/)
  })
})

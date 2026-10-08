// @vitest-environment happy-dom
/*
 * V8 移行で崩れる原因⑤：画面の CSS が型の余白を上書きしていた。
 *
 * 1画面の★V8に要る違いは型の明示の口（CreatePage の contentSpacing・previewSurface）で選び、
 * 画面の CSS から `[data-template-region=…]` の余白を書き換えない。渡さない画面は型の既定のまま
 * （1画面の寸法を全画面へ押し付けない）。
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CreatePage } from './index'

const WEB = process.cwd()
const read = (path: string) => readFileSync(join(WEB, path), 'utf8')

afterEach(cleanup)

describe('作成の型の余白の口', () => {
  it('渡さなければ型の既定（印を出さない）', () => {
    const { container } = render(<CreatePage title="作成" preview={<p>見え方</p>} footerActions={null}>入力</CreatePage>)
    const content = container.querySelector('[data-template-region="content"]')!
    const preview = container.querySelector('[data-template-region="preview"]')!
    expect(content.hasAttribute('data-content-spacing')).toBe(false)
    expect(preview.hasAttribute('data-content-spacing')).toBe(false)
    expect(preview.hasAttribute('data-preview-surface')).toBe(false)
  })

  it('flush-top・plain を渡すと入力欄と右の列に印が付く', () => {
    const { container } = render(
      <CreatePage title="作成" contentSpacing="flush-top" previewSurface="plain" preview={<p>見え方</p>} footerActions={null}>入力</CreatePage>,
    )
    expect(container.querySelector('[data-template-region="content"]')!.getAttribute('data-content-spacing')).toBe('flush-top')
    const preview = container.querySelector('[data-template-region="preview"]')!
    expect(preview.getAttribute('data-content-spacing')).toBe('flush-top')
    expect(preview.getAttribute('data-preview-surface')).toBe('plain')
  })

  it('口の寸法は型の CSS と globals の値に1か所（E-9 p17Qku：上 4・左右 24・下 24、段の間 28）', () => {
    const css = read('src/components/templates/page-templates.module.css')
    expect(css).toContain(".createContent[data-content-spacing='flush-top'] { padding: var(--tpl-create-flush-pad); gap: var(--tpl-create-flush-gap); }")
    expect(css).toContain(".preview[data-content-spacing='flush-top'] { padding: var(--tpl-create-flush-pad); }")
    expect(css).toContain(".preview[data-preview-surface='plain'] { background: transparent; }")
    const globals = read('src/app/globals.css')
    expect(globals).toMatch(/--tpl-create-flush-pad:\s*4px 24px 24px;/)
    expect(globals).toMatch(/--tpl-create-flush-gap:\s*28px;/)
  })

  it('統括の一括配信を作るは店の一斉配信を作る画面と同じ枠（店の CSS）を使い、画面の CSS で型の余白を上書きしない', () => {
    expect(read('src/v8/hq-broadcasts/create.module.css')).not.toContain('data-template-region')
    const tsx = read('src/v8/hq-broadcasts/create.tsx')
    /* B-37（10-08）：店の一斉配信と同じ5段。枠・段の帯・右の列・下の帯は店の作る画面の CSS をそのまま読む（写さない）。 */
    expect(tsx).toContain("import formStyles from '@/components/broadcasts/broadcast-form-v8.module.css'")
    expect(tsx).toMatch(/<StickyBar className=\{formStyles\.footer\}/)
  })
})

/*
 * 今も画面の CSS で型の欄（[data-template-region=…]）を書き換えている所。増やさない。
 * どれも設定の型（SettingsPage）の中身の幅・余白を絵に広げるもので、型の口に移すのは
 * 寸法を絵と照合してから（V8 移行の報告の一覧）。直したらここから消す。
 */
const KNOWN_REGION_OVERRIDES = [
  'src/v8/accounts-detail/detail.module.css',
  'src/v8/accounts-detail/handover.module.css',
  'src/v8/settings/sa-frame.module.css',
  'src/v8/settings/sb-frame/settings-screen.module.css',
]

describe('画面の CSS が型の欄を書き換える所は増やさない', () => {
  it('src/v8 の CSS で [data-template-region] を選ぶ所は既知の一覧だけ', () => {
    let out = ''
    try {
      out = execFileSync('git', ['grep', '-l', 'data-template-region', '--', 'src/v8/**/*.css'], { cwd: WEB, encoding: 'utf8' })
    } catch {
      out = '' // 1件も無いと git grep は 1 で終わる
    }
    const files = out.split('\n').filter(Boolean).map((f) => (f.startsWith('src/') ? f : f.replace(/^apps\/web\//, ''))).sort()
    expect(files).toEqual([...KNOWN_REGION_OVERRIDES].sort())
  })
})

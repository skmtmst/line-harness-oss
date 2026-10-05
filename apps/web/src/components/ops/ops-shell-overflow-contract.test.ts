import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(import.meta.url))
const SHELL = readFileSync(join(ROOT, 'ops-shell.tsx'), 'utf8')
const HEADER = readFileSync(join(ROOT, 'ops-page-header.tsx'), 'utf8')

/*
 * #974 U094: 390pxでも256pxのナビが常設され、本文には左右80pxの余白が
 * 残っていた。見出しが1文字ずつに割れ、検索・件名・本文・操作が画面外へ
 * 出た。狭い画面はナビを開閉式にし、本文の余白は16pxに切り替える。
 */
describe('U094 運営コンソールの外枠', () => {
  it('1280px未満ではナビを常設せず、本文の上に開く操作を置く', () => {
    expect(SHELL).toContain('xl:hidden')
    expect(SHELL).toContain('メニュー')
    expect(SHELL).toContain('onClick={() => setNavOpen(true)}')
    expect(SHELL).toContain('aria-expanded={navOpen}')
  })

  it('開いたナビは画面の上に重なる開閉式で、1280px以上だけ常設に戻す', () => {
    expect(SHELL).toContain('fixed inset-y-0 left-0 z-50')
    expect(SHELL).toContain('xl:static')
    expect(SHELL).toContain('xl:flex')
    // 閉じている間は display:none で、幅もフォーカスも取らない。
    expect(SHELL).toContain("open ? 'flex' : 'hidden'")
  })

  it('開いたナビは暗幕・Escape・画面移動で閉じ、背面のスクロールを止める', () => {
    expect(SHELL).toContain('fixed inset-0 z-40')
    expect(SHELL).toContain('onClick={onClose}')
    expect(SHELL).toContain("event.key === 'Escape'")
    expect(SHELL).toContain('setNavOpen(false) }, [pathname]')
    expect(SHELL).toContain("document.body.style.overflow = 'hidden'")
  })

  it('本文の左右の余白は狭い画面では16px、1280px以上で40pxに戻す', () => {
    expect(SHELL).toContain('px-4 pb-8 pt-4 xl:px-10')
    expect(SHELL).not.toContain('px-10 pb-8 pt-4')
  })

  it('画面見出しは操作が入ると下へ折り返し、1文字ずつに割れない', () => {
    expect(HEADER).toContain('flex-wrap')
    expect(HEADER).toContain('min-h-14')
    expect(HEADER).not.toContain('flex h-14')
  })

  /*
   * 縦に長い画面（監査ログなど）で、左下のアカウント情報が本文と一緒に
   * 下へ送られ、一番下までスクロールしないと見えなかった。外枠の高さを
   * 画面に合わせ、縦に流れるのは本文の中だけにする。
   */
  it('外枠は画面の高さに収め、縦に流れるのは本文の中だけにする', () => {
    expect(SHELL).toContain('flex h-svh flex-col overflow-hidden')
    expect(SHELL).not.toContain('flex min-h-svh flex-col bg-canvas-sunken')
    expect(SHELL).toContain('<div className="flex min-h-0 flex-1">')
    expect(SHELL).toContain("navOpen ? 'overflow-hidden' : 'overflow-y-auto'")
    expect(SHELL).toContain('id="ops-main"')
  })

  it('左下のアカウント情報は常に見え、流れるのはメニューの部分だけ', () => {
    // サイドバー自体はスクロールさせない（中の nav だけが流れる）。
    expect(SHELL).toContain('w-64 shrink-0 flex-col overflow-hidden')
    expect(SHELL).toContain('<nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-3">')
    // 上の見出しと下のアカウントは縮まない。
    expect(SHELL).toContain('flex shrink-0 items-center gap-3 px-4 py-4')
    expect(SHELL).toContain('relative shrink-0 px-3 py-3')
  })
})

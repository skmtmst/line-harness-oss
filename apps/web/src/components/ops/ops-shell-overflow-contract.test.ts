import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(import.meta.url))
const SHELL = readFileSync(join(ROOT, '..', '..', 'v8', 'ops', 'shell.tsx'), 'utf8')
const CSS = readFileSync(join(ROOT, '..', '..', 'v8', 'ops', 'shell.module.css'), 'utf8')
const COMMON = readFileSync(join(ROOT, '..', 'app-shell.module.css'), 'utf8')
const NAV = readFileSync(join(ROOT, '..', 'layout', 'sidebar.module.css'), 'utf8')
const OVERLAY = readFileSync(join(ROOT, '..', 'shared', 'overlay-utils.ts'), 'utf8')
const ACTIONS = readFileSync(join(ROOT, '..', 'shared', 'action-menu.tsx'), 'utf8')

/*
 * #974 U094: 390pxでも256pxのナビが常設され、本文には左右80pxの余白が
 * 残っていた。見出しが1文字ずつに割れ、検索・件名・本文・操作が画面外へ
 * 出た。狭い画面はナビを開閉式にし、本文の余白は16pxに切り替える。
 */
describe('U094 運営コンソールの外枠', () => {
  it('1024px未満ではナビを常設せず、本文の上に開く操作を置く', () => {
    expect(CSS).toContain('@media (min-width: 1024px)')
    expect(CSS).toMatch(/\.mobileBar\s*\{\s*display:\s*none/)
    expect(SHELL).toContain('メニュー')
    expect(SHELL).toContain('onClick={() => setDrawer(true)}')
    expect(SHELL).toContain('aria-expanded={drawer}')
  })

  it('開いたナビは画面の上に重なる開閉式で、1024px以上だけ常設に戻す', () => {
    expect(CSS).toMatch(/\.drawer\s*\{[^}]*position:\s*fixed/s)
    expect(SHELL).toContain('className={nav.desktop}')
    expect(NAV).toContain('display: flex')
    // 閉じている間は display:none で、幅もフォーカスも取らない。
    expect(SHELL).toContain('{drawer ? (')
  })

  it('開いたナビは暗幕・Escape・画面移動で閉じ、背面のスクロールを止める', () => {
    expect(CSS).toMatch(/\.scrim\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0/s)
    expect(SHELL).toContain('onClick={() => setDrawer(false)}')
    expect(SHELL).toContain('useOverlayFocus<HTMLElement>(drawer')
    expect(OVERLAY).toContain("event.key === 'Escape'")
    expect(SHELL).toContain('setDrawer(false) }, [pathname]')
    expect(OVERLAY).toContain("document.body.style.overflow = 'hidden'")
  })

  it('本文の左右の余白は狭い画面では現在の共通外枠の余白へそろえる', () => {
    expect(SHELL).toContain('className={shellStyles.content}')
    expect(COMMON).toContain('@media (min-width: 1024px)')
    expect(COMMON).toContain('padding: 24px 16px')
  })


  /*
   * 縦に長い画面（監査ログなど）で、左下のアカウント情報が本文と一緒に
   * 下へ送られ、一番下までスクロールしないと見えなかった。外枠の高さを
   * 画面に合わせ、縦に流れるのは本文の中だけにする。
   */
  it('外枠は画面の高さに収め、縦に流れるのは本文の中だけにする', () => {
    expect(SHELL).toContain('className={shellStyles.shell}')
    expect(SHELL).not.toContain('flex min-h-svh flex-col bg-canvas-sunken')
    expect(SHELL).toContain('className={shellStyles.workspace}')
    expect(COMMON).toMatch(/\.main\s*\{[^}]*overflow:\s*auto/s)
    expect(SHELL).toContain('id="ops-main"')
  })

  it('自分の操作と下の入口は常に見え、流れるのはメニューの部分だけ', () => {
    // サイドバー自体はスクロールさせない（中の nav だけが流れる）。
    expect(SHELL).toContain('className={nav.desktop}')
    expect(SHELL).toContain('<nav className={nav.nav}')
    expect(NAV).toMatch(/\.nav\s*\{[^}]*overflow-y:\s*auto/s)
    // 上の見出しと下のアカウントは縮まない。
    expect(SHELL).toContain('className={nav.settingsEntry}')
  })

  it('利用者メニューは矢印キーで項目を移動できる', () => {
    expect(ACTIONS).toContain('role="menu"')
    expect(ACTIONS).toContain('querySelectorAll<HTMLElement>')
    expect(SHELL).toContain("href: '/staff'")
    expect(ACTIONS).toContain("['ArrowDown', 'ArrowUp', 'Home', 'End']")
  })
})

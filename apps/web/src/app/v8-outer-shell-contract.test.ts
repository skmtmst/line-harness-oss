/*
 * ★V8 移行③「外側 v8」の固定。
 *
 *   - 地は灰（--color-shell）、中身は白い板1枚（radius 16・枠・影・右下左 12px）
 *   - 上の帯は高さ 60・パンくず（アカウント › 画面名）・通知ベル・自分。
 *     探す欄は帯から外した（オーナー決定 2026-10-01）。
 *     左メニューは畳める（64px・⌘\・localStorage）
 *   - 黄色の版の帯は v8 では出さない
 *   - 全部 v8 だけに効く（v7 の見た目を動かさない）
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WEB = join(__dirname, '..', '..')
const globals = readFileSync(join(WEB, 'src/app/globals.css'), 'utf8')
const appShell = readFileSync(join(WEB, 'src/components/app-shell.tsx'), 'utf8')
const appShellCss = readFileSync(join(WEB, 'src/components/app-shell.module.css'), 'utf8')
const sidebar = readFileSync(join(WEB, 'src/components/layout/sidebar.tsx'), 'utf8')
const sidebarCss = readFileSync(join(WEB, 'src/components/layout/sidebar.module.css'), 'utf8')
const topBar = readFileSync(join(WEB, 'src/components/shared/top-bar.tsx'), 'utf8')
const topBarCss = readFileSync(join(WEB, 'src/components/shared/top-bar.module.css'), 'utf8')
const appTopBar = readFileSync(join(WEB, 'src/components/shell/app-top-bar.tsx'), 'utf8')
const events = readFileSync(join(WEB, 'src/lib/events.ts'), 'utf8')
const friends = readFileSync(join(WEB, 'src/app/friends/page.tsx'), 'utf8')

describe('外側の殻（V8 移行③）', () => {
  it('v8 のときだけ出す・消すための印がある（v8-only / v7-only）', () => {
    expect(globals).toContain('[data-theme="v8"] .v7-only')
    expect(globals).toContain('.v8-only')
  })

  it('テーマのときだけ効くユーティリティ v7: / v8: がある（@custom-variant）', () => {
    expect(globals).toContain('@custom-variant v7')
    expect(globals).toContain('@custom-variant v8')
    expect(globals).toContain(':root:not([data-theme="v8"])')
  })

  it('中身は白い板1枚（radius 16・枠・薄い影・右下左に 12px）で、v8 のときだけ', () => {
    const board = appShellCss.match(/\[data-theme="v8"\] \.main \{([\s\S]*?)\}/)
    expect(board, 'v8 の .main の板の規定が無い').not.toBeNull()
    expect(board![1]).toContain('border-radius: var(--radius-panel)')
    expect(board![1]).toContain('border: 1px solid var(--color-board-line)')
    expect(board![1]).toContain('box-shadow: var(--shadow-board)')
    // 左メニューが右に12の余白を持つので、板の左は0（二重にしない）。
    expect(board![1]).toContain('margin: 0 12px 12px 0')
  })

  it('黄色の版の帯は v8 では出さない（v7-only で包む）', () => {
    expect(appShell).toMatch(/v7-only.*UpdateBanner|UpdateBanner.*v7-only/s)
  })

  it('左メニューは地の上に直接置き（枠・白地を外す）、幅は 240px', () => {
    const blocks = [...sidebarCss.matchAll(/\[data-theme="v8"\] \.desktop \{([^}]*)\}/g)]
    const aside = blocks.find((b) => b[1].includes('width: 240px'))
    expect(aside, 'v8 の .desktop（幅 240）の規定が無い').not.toBeUndefined()
    expect(aside![1]).toContain('border-right: 0')
    expect(aside![1]).toContain('background: transparent')
  })

  it('いまの項目は白い地＋薄い影（緑のベタ塗りではない）', () => {
    const active = sidebarCss.match(/\[data-theme="v8"\] \.active \{([\s\S]*?)\}/)
    expect(active, 'v8 の .active の規定が無い').not.toBeNull()
    expect(active![1]).toContain('background: var(--color-canvas)')
    expect(active![1]).toContain('box-shadow')
  })

  it('左メニューは畳める（幅 64・状態をブラウザに覚える・⌘\\ とボタンで切替）', () => {
    expect(sidebarCss).toMatch(/\.desktop\[data-collapsed\][\s\S]*?width: 64px/)
    expect(sidebar).toContain('lh-sidebar-collapsed')
    expect(sidebar).toContain('data-collapsed')
    expect(sidebar).toContain('SIDEBAR_TOGGLE_EVENT')
    expect(events).toContain("SIDEBAR_TOGGLE_EVENT = 'lh:sidebar-toggle'")
    expect(topBar).toContain('SIDEBAR_TOGGLE_EVENT')
  })

  it('帯は高さ 60・地の上・下線なし。左にパンくず（アカウント › 画面名）', () => {
    const root = topBarCss.match(/\[data-theme="v8"\] \.root \{([\s\S]*?)\}/)
    expect(root, 'v8 の .root の規定が無い').not.toBeNull()
    expect(root![1]).toContain('height: 60px')
    expect(root![1]).toContain('background: transparent')
    expect(topBar).toContain('aria-label="パンくず"')
    expect(topBar).toContain('crumbCurrent')
  })

  it('帯の右は 通知・自分（探す欄は V8 で外した）。友だち一覧の ?q= 受け口は残す', () => {
    expect(topBar).not.toContain('role="search"')
    expect(topBar).not.toContain('⌘K')
    expect(topBar).not.toContain('onGlobalSearch')
    expect(appTopBar).not.toContain('/friends?q=')
    expect(topBar).toContain('href="/notifications"')
    expect(topBar).toContain('bellBadge')
    // `?q=` で開く受け口は一覧側の機能なので残る
    expect(friends).toContain("searchParams.get('q')")
  })

  it('帯が混まないよう、v8 はアカウント名 128px・自分の名前 104px で「…」に収める', () => {
    const account = topBarCss.match(/\[data-theme="v8"\] \.accountName \{([^}]*)\}/)
    expect(account, 'v8 の .accountName の規定が無い').not.toBeNull()
    expect(account![1]).toContain('max-width: 128px')
    const user = topBarCss.match(/\[data-theme="v8"\] \.user \{([^}]*)\}/)
    expect(user, 'v8 の .user の規定が無い').not.toBeNull()
    expect(user![1]).toContain('max-width: 104px')
  })

  it('1152 未満ではログアウトを印だけにする（字は消えても aria-label が残る）', () => {
    expect(topBarCss).toMatch(/@media \(max-width: 1151px\)[\s\S]*?\.logout span[\s\S]*?display: none/)
    expect(topBar).toContain('aria-label="ログアウト"')
  })

  it('v8 の帯は 1024px から出す（v7 は 1280px のまま）', () => {
    expect(globals).toContain('.v8-topbar-wrap')
    expect(appTopBar).toContain('hidden xl:block v8-topbar-wrap')
  })

  it('畳み・検索・通知は v7 では描かない（v8-only / v8Chrome の門）', () => {
    expect(topBar).toContain('v8-only')
    expect(topBar).toContain('v8Chrome')
    // 左メニューの無い殻に畳みボタンを出さない
    expect(appShell).toContain('SuspendedSupportWorkspace')
  })
})

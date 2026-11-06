import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * 統括のアカウントメニュー・お問い合わせ・メンバー管理の決まり。
 * 動き（メニューの行と行き先・ログアウト・キーボード・最上層の器、表・招待の役割・送る口、
 * お問い合わせの必須と送信、画面名）は描いて押す試験が見る：
 * components/hq/sidebar-account-menu-react・members/hq-account-react・members/members-failure-react。
 * ここに残すのは、戻してはいけない古い形の禁止の見張りと、ブラウザでしか測れない寸法（v8-guard へ移すまで）だけ。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const menu = read('../../../components/hq/account-menu.tsx')
const menuCss = read('../../../components/hq/account-menu.module.css')
const members = read('../../../v8/hq/members.tsx')
const support = read('../../../v8/hq/support.tsx')
const topBar = read('../../../components/shell/app-top-bar.tsx')

describe('統括の左下アカウントメニュー', () => {
  it('まだ無い画面（プロフィール）・準備中の行・独自のログアウト・古い置き方・下に足す札へ戻さない', () => {
    expect(menu).not.toMatch(/href="\/hq\/profile"/)
    expect(menu).not.toContain('準備中')
    expect(topBar).not.toContain('auth/logout')
    expect(menu).not.toContain('absolute bottom-full left-0')
    expect(menu).not.toContain('{chip ? <PlanChip chip={chip} /> : null}')
    expect(menu).not.toContain('billingNote')
  })

  /*
   * 2026-10-06 の直し（Pencil 承認 `LINE-Harness-V8-B.pen` の `s6kZt/wmfIZ`）。
   * 幅240固定・行の高さ40は happy-dom では測れないので、ブラウザの崩れの見張りへ移すまで文字で持つ。
   */
  it('開いたメニューは幅240で固定し、行の高さは40', () => {
    expect(menuCss).toContain('width: 240px')
    expect(menuCss).toContain('height: 40px')
  })
})

describe('メンバー管理（36-5）・お問い合わせ（36-3）', () => {
  it('タブの住所・下部追従バー・独自の h1 へ戻さない', () => {
    expect(members).not.toContain('?tab=')
    expect(support).not.toContain('<StickyBar')
    expect(support).not.toContain('<h1')
    expect(members).not.toContain('<h1')
  })
})

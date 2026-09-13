import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const menu = read('../../../components/hq/account-menu.tsx')
const sidebar = read('../../../components/layout/sidebar.tsx')
const members = read('./page.tsx')
const support = read('../support/page.tsx')
const settings = read('../settings/page.tsx')
const topBar = read('../../../components/shell/app-top-bar.tsx')

/**
 * ★V6 36-1（アカウントメニュー）・36-3（お問い合わせ）・36-5（メンバー管理）の見張り。
 * 正本は Pencil `V6正本.pen` と `docs/v6-requirements/v6-36-hq-account-billing-requirements-draft.md`。
 */
describe('統括の左下アカウントメニュー', () => {
  it('統括のサイドバーだけに置き、店舗の画面は下端に何も置かない（§1-2 の例外）', () => {
    expect(sidebar).toContain("{isHq ? <HqAccountMenu /> : <div className={styles.footer} />}")
  })

  it('メニューにはメンバー管理・お問い合わせ・ログアウトを置き、まだ無い画面（課金プラン・プロフィール）は出さない', () => {
    expect(menu).toContain('href="/hq/members"')
    expect(menu).toContain('href="/hq/support"')
    expect(menu).toContain('logoutAndGoToLogin')
    expect(menu).not.toMatch(/href="\/hq\/(billing|profile)"/)
    expect(menu).not.toContain('準備中')
  })

  it('ログアウトはトップバーと同じ処理を使う', () => {
    expect(topBar).toContain('logoutAndGoToLogin')
    expect(topBar).not.toContain('auth/logout')
  })

  it('Esc と外側の押下で閉じ、押した要素へフォーカスを戻す', () => {
    expect(menu).toContain("event.key === 'Escape'")
    expect(menu).toContain("addEventListener('mousedown'")
    expect(menu).toContain('triggerRef.current?.focus()')
  })
})

describe('メンバー管理（36-5）', () => {
  it('旧「統括設定」はメンバー管理へ転送する', () => {
    expect(settings).toContain("router.replace('/hq/members?tab=tenant')")
  })

  it('タブは ?tab= で切り替え、権限者と統括の情報を1画面に置く', () => {
    expect(members).toContain("params.get('tab') === 'tenant'")
    expect(members).toContain("router.replace(next === 'tenant' ? '/hq/members?tab=tenant' : '/hq/members')")
    expect(members).toContain('api.tenants.updateName(trimmed)')
  })

  it('招待は管理者と閲覧のみだけを選べる（担当者は統括の権限者にしない）', () => {
    const dialog = read('../../../components/hq/members/member-dialog.tsx')
    expect(dialog).toContain("{ value: 'admin', label: '管理者（すべて操作できる）' }")
    expect(dialog).toContain("{ value: 'viewer', label: '閲覧のみ（見るだけ）' }")
    expect(dialog).not.toContain("value: 'staff'")
    expect(members).toContain("managementContext: 'hq'")
  })

  it('表は共通の DataTable で、最終ログインと再送を出す', () => {
    expect(members).toContain('<DataTable>')
    expect(members).toContain('api.staff.lastLogins()')
    expect(members).toContain('api.staff.resendInvite(member.id)')
    expect(members).toContain('（あなた）')
  })

  it('保存は下部追従バーにしか置かない', () => {
    expect(members).toContain('<StickyBar')
    expect(members).toContain('統括名を保存')
  })
})

describe('お問い合わせ（36-3）', () => {
  it('種類・件名・本文は必須、店舗と画像は任意', () => {
    expect(support).toContain('label="種類" required')
    expect(support).toContain('label="件名" required')
    expect(support).toContain('label="本文" required')
    expect(support).toContain('label="関係する店舗" note="任意"')
    expect(support).toContain('accept="image/png,image/jpeg"')
  })

  it('送信は下部追従バーにしか置かず、控えが届くことを状態文で言う', () => {
    expect(support).toContain('<StickyBar')
    expect(support).toContain('送信すると、控えが登録メールアドレスにも届きます')
    expect(support).toContain('api.hqSupport.create(')
  })

  it('画面名はトップバーだけに出す', () => {
    expect(support).toContain("usePageTitle('お問い合わせ')")
    expect(members).toContain("usePageTitle('メンバー管理')")
    expect(support).not.toContain('<h1')
    expect(members).not.toContain('<h1')
  })
})

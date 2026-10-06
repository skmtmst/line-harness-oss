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
  it('統括のサイドバーだけに置き、アカウントの画面は下端に何も置かない（§1-2 の例外）', () => {
    // V8 移行③: 畳んだメニューでは枠ごと隠す collapseHide の皮で包む。
    expect(sidebar).toContain("{isHq ? <div className={styles.collapseHide}><HqAccountMenu /></div> : <div className={styles.footer} />}")
  })

  it('メニューにはメンバー管理・課金プラン・お問い合わせ・ログアウトを置き、まだ無い画面（プロフィール）は出さない', () => {
    expect(menu).toContain('href="/hq/members"')
    expect(menu).toContain('href="/hq/billing"')
    expect(menu).toContain('href="/hq/support"')
    expect(menu).toContain('logoutAndGoToLogin')
    expect(menu).not.toMatch(/href="\/hq\/profile"/)
    expect(menu).not.toContain('準備中')
  })

  it('ログアウトはトップバーと同じ処理を使う', () => {
    expect(topBar).toContain('logoutAndGoToLogin')
    expect(topBar).not.toContain('auth/logout')
  })

  it('Esc で閉じて押した要素へフォーカスを戻し、外側の押下は器（MenuPortal）が閉じる', () => {
    expect(menu).toContain("event.key === 'Escape'")
    expect(menu).toContain('triggerRef.current?.focus()')
    expect(menu).toContain('onClose={() => setOpen(false)}')
  })

  /*
   * 2026-10-06 の直し（Pencil 承認 `LINE-Harness-V8-B.pen` の `s6kZt/wmfIZ`）。
   * 脇メニューの幅に揃えると中身が枠からはみ出したので、運営コンソールと
   * 同じ「最上層の器＋幅240固定＋右の説明なし＋行の高さ40」に合わせた。
   */
  it('開いたメニューは最上層の器に出し、幅240で固定して行の右に説明を置かない', () => {
    expect(menu).toContain('<MenuPortal')
    expect(menu).toContain('w-60 rounded-mini border border-hairline bg-canvas py-2 shadow-float')
    expect(menu).toContain('flex h-10 items-center gap-2.5 px-3.5 text-label')
    expect(menu).toContain('h-px bg-divider-soft')
    expect(menu).not.toContain('absolute bottom-full left-0')
    expect(menu).not.toContain('権限者・担当アカウント')
    expect(menu).not.toContain('プランと支払い')
  })
})

describe('メンバー管理（36-5）', () => {
  it('統括の情報は /hq/settings で見せる（板 yLKwV・BHEl9 にタブは無いため。旧「統括設定」の転送はやめた）', () => {
    expect(settings).toContain('api.tenants.updateName(trimmed)')
    expect(settings).toContain("usePageTitle('統括の情報')")
    expect(members).not.toContain('?tab=')
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

  it('保存は下部追従バーにしか置かない（統括名の保存は /hq/settings）', () => {
    expect(settings).toContain('<StickyBar')
    expect(settings).toContain('統括名を保存する')
  })
})

describe('お問い合わせ（36-3）', () => {
  it('種類・件名・本文は必須、アカウントと画像は任意', () => {
    expect(support).toContain('label="種類" required')
    expect(support).toContain('label="件名" required')
    expect(support).toContain('label="本文" required')
    expect(support).toContain('label="関係する店舗" note="任意"')
    expect(support).toContain('accept="image/png,image/jpeg"')
  })

  it('送信は問い合わせカードの中に置き、下部追従バーは出さない（板 b8xBtZ）', () => {
    expect(support).not.toContain('<StickyBar')
    expect(support).toContain('内容をクリア')
    expect(support).toContain('控えが登録メールアドレスにも届きます')
    expect(support).toContain('api.hqSupport.create(')
  })

  it('画面名はトップバーだけに出す', () => {
    expect(support).toContain("usePageTitle('お問い合わせ')")
    expect(members).toContain("usePageTitle('メンバー管理')")
    expect(support).not.toContain('<h1')
    expect(members).not.toContain('<h1')
  })

  it('アカウントメニューは矢印キーで項目を移動できる', () => {
    expect(menu).toContain('role="menu"')
    expect(menu).toContain('onKeyDown={(event: ReactKeyboardEvent<HTMLElement>)')
  })
})

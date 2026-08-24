import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HQ_MENU_SECTIONS, MENU_SECTIONS } from '@/lib/menu'

const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const accountList = readFileSync(new URL('../../components/hq/account-list.tsx', import.meta.url), 'utf8')
const openPage = readFileSync(new URL('./open/page.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../../components/app-shell.tsx', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../../components/layout/sidebar.tsx', import.meta.url), 'utf8')

describe('統括コンソール', () => {
  it('既存のLINEアカウント一覧APIだけで店舗一覧を作る', () => {
    expect(page).toContain('api.lineAccounts.list()')
    expect(page).not.toContain('restaurantTestApi')
    expect(page).toContain('<HqAccountList')
    expect(accountList).toContain('pictureUrl')
    expect(accountList).toContain('stats?.friendCount')
    expect(accountList).toContain('webhook?.status')
  })

  it('各店舗の設定から既存編集モーダルを開き、保存後に一覧を再読込する', () => {
    expect(page).toContain('AccountEditModal')
    expect(page).toContain('onSettings={setEditingAccount}')
    expect(page).toContain('initialChannelId={editingAccount.channelId}')
    expect(page).toContain('Promise.all([load(), refreshAccounts()])')
    expect(accountList).toContain('onSettings(account)')
    expect(accountList).toContain('設定')
  })

  it('ログインは選択中アカウントを保存して識別子なしのトップへ移動する', () => {
    expect(page).toContain('setSelectedAccountId(accountId)')
    expect(page).toContain("router.push('/')")
    expect(page).not.toContain('?account')
    expect(page).not.toContain('?store')
  })

  it('統括へ戻る共通ボタンと着地点ゲートを全店舗画面に置く', () => {
    expect(shell).toContain('<HqReturnButton />')
    expect(shell).toContain('<RootLandingGate><StoreSelectionGate>{children}</StoreSelectionGate></RootLandingGate>')
  })

  it('統括と店舗のサイドバーを分け、採用フローを作らない', () => {
    expect(sidebar).toContain('HQ_MENU_SECTIONS')
    expect(HQ_MENU_SECTIONS.flatMap((section) => section.items).map((item) => item.label)).toEqual([
      '店舗管理', 'タグ', 'テンプレート管理', 'リッチメニュー管理', '回答フォーム管理', '設定',
    ])
    expect(HQ_MENU_SECTIONS.flatMap((section) => section.items).some((item) => item.label === '採用フロー管理')).toBe(false)
    expect(HQ_MENU_SECTIONS.flatMap((section) => section.items).map((item) => item.href)).toEqual([
      '/hq',
      '/hq/open?target=tags',
      '/hq/open?target=templates',
      '/hq/open?target=rich-menus',
      '/hq/open?target=form-submissions',
      '/hq/settings',
    ])
  })

  it('統括の4項目は同じ店舗一覧を流用し、選択後に識別子なしで遷移する', () => {
    expect(openPage).toContain('<HqAccountList')
    expect(openPage).toContain('setSelectedAccountId(accountId)')
    expect(openPage).toContain('router.push(target.destination)')
    expect(openPage).toContain("router.replace('/hq')")
    expect(openPage).not.toContain('?account')
    expect(openPage).not.toContain('?store')
  })

  it('旧店舗一覧画面は残して統括へ転送し、店舗サイドバーから外す', () => {
    // D-3: 旧URLの互換性を残しながら一覧の正本を /hq に限定する。
    expect(MENU_SECTIONS.flatMap((section) => section.items).some((item) => item.href === '/restaurant-test/stores')).toBe(false)
    expect(readFileSync(new URL('../restaurant-test/stores/page.tsx', import.meta.url), 'utf8')).toContain("redirect('/hq')")
    expect(MENU_SECTIONS.flatMap((section) => section.items).some((item) => ['アカウント', 'データ移行'].includes(item.label))).toBe(false)
  })
})

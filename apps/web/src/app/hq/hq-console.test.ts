import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HQ_MENU_SECTIONS, MENU_SECTIONS } from '@/lib/menu'

const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../../components/app-shell.tsx', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../../components/layout/sidebar.tsx', import.meta.url), 'utf8')

describe('統括コンソール', () => {
  it('既存のLINEアカウント一覧APIだけで店舗一覧を作る', () => {
    expect(page).toContain('api.lineAccounts.list()')
    expect(page).not.toContain('restaurantTestApi')
    expect(page).toContain('pictureUrl')
    expect(page).toContain('stats?.friendCount')
    expect(page).toContain('webhook?.status')
  })

  it('ログインは選択中アカウントを保存して識別子なしのトップへ移動する', () => {
    expect(page).toContain('setSelectedAccountId(accountId)')
    expect(page).toContain("router.push('/')")
    expect(page).not.toContain('?account')
    expect(page).not.toContain('?store')
  })

  it('統括へ戻る共通ボタンと着地点ゲートを全店舗画面に置く', () => {
    expect(shell).toContain('<HqReturnButton />')
    expect(shell).toContain('<RootLandingGate>{children}</RootLandingGate>')
  })

  it('統括と店舗のサイドバーを分け、採用フローを作らない', () => {
    expect(sidebar).toContain('HQ_MENU_SECTIONS')
    expect(HQ_MENU_SECTIONS.flatMap((section) => section.items).map((item) => item.label)).toEqual([
      '店舗管理', 'タグ', 'テンプレート管理', 'リッチメニュー管理', '回答フォーム管理', '設定',
    ])
    expect(HQ_MENU_SECTIONS.flatMap((section) => section.items).some((item) => item.label === '採用フロー管理')).toBe(false)
  })

  it('旧店舗一覧画面は残し、店舗サイドバーからだけ外す', () => {
    expect(MENU_SECTIONS.flatMap((section) => section.items).some((item) => item.href === '/restaurant-test/stores')).toBe(false)
    expect(readFileSync(new URL('../restaurant-test/stores/page.tsx', import.meta.url), 'utf8')).toBeTruthy()
  })
})

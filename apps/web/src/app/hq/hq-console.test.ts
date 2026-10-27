import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HQ_MENU_SECTIONS, MENU_SECTIONS } from '@/lib/menu'

/*
 * 統括コンソールの決まり。動き（一覧・接続の確かめ直し・設定・入る・門・入口ページ）は描いて押す試験が見る：
 * hq-home-wiring-react・account-browser-v8-react・open/hq-open-account-load-failure-react・hq-entry-pages-react・
 * components/hq/account-list-react・components/app-shell-gates-react・components/hq/sidebar-account-menu-react。
 * ここに残すのは、メニューの定義と、戻してはいけない古い形の禁止の見張りだけ。
 */
const page = readFileSync(new URL('../../v8/hq/home.tsx', import.meta.url), 'utf8')
const openPage = readFileSync(new URL('./open/page.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../../components/app-shell.tsx', import.meta.url), 'utf8')

describe('統括コンソール', () => {
  it('飲食の試験用 API・説明バー・識別子つきの住所へ戻さない', () => {
    expect(page).not.toContain('restaurantTestApi')
    expect(page).not.toContain('NoteBar')
    expect(page).not.toContain('LINE公式アカウントごとに管理画面へ入れます。')
    for (const source of [page, openPage]) {
      expect(source).not.toContain('?account')
      expect(source).not.toContain('?store')
    }
    // 本文に浮いていた「統括」ボタンは左下の自分のメニューへ畳んだ。
    expect(shell).not.toContain('<HqReturnButton />')
  })

  it('統括とアカウントのサイドバーを分け、採用フローを作らない', () => {
    expect(HQ_MENU_SECTIONS.flatMap((section) => section.items).map((item) => item.label)).toEqual([
      // 提案 E-9（2026-10-07 オーナー採用）：統括の一括配信を末尾に足した。（2026-10-16）：一番上に「対応が要るもの」。
      '対応が要るもの', 'アカウント', '店の比較', 'タグ', 'テンプレート', 'リッチメニュー', '回答フォーム', 'バナー生成', '一括配信',
    ])
    expect(HQ_MENU_SECTIONS.flatMap((section) => section.items).some((item) => item.label === '採用フロー管理')).toBe(false)
    expect(HQ_MENU_SECTIONS.flatMap((section) => section.items).map((item) => item.href)).toEqual([
      '/hq/attention',
      '/hq',
      '/hq/store-comparison',
      '/hq/friend-attributes',
      '/hq/templates',
      '/hq/rich-menus',
      '/hq/form-submissions',
      '/hq/banners',
      '/hq/broadcasts',
    ])
    // 「設定」は左下の「統括の設定」へ移した（v8-sidebar-groups-react が描いて見る）。
    expect(HQ_MENU_SECTIONS.flatMap((section) => section.items).some((item) => item.href === '/hq/settings')).toBe(false)
  })

  it('旧アカウント一覧はアカウントのサイドバーから外す（住所は hq-entry-pages-react が統括への転送を見る）', () => {
    expect(MENU_SECTIONS.flatMap((section) => section.items).some((item) => item.href === '/restaurant-test/stores')).toBe(false)
    expect(MENU_SECTIONS.flatMap((section) => section.items).some((item) => ['アカウント', 'データ移行'].includes(item.label))).toBe(false)
  })
})

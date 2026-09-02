import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_SELECTION_KEY,
  AUTH_SELECTION_CLEARED_KEY,
  HQ_OPEN_TARGETS,
  clearSelectionAfterAuthentication,
  decideRootLanding,
  hqOpenHref,
  resolveHqOpenTarget,
} from './hq-navigation'

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

describe('ログイン直後の着地点', () => {
  it('見える店舗が0件なら統括へ移動する', () => {
    expect(decideRootLanding(false, null, [])).toEqual({ action: 'go-hq' })
  })

  it('見える店舗が1件ならその店舗を自動選択する', () => {
    expect(decideRootLanding(false, null, ['account-1']))
      .toEqual({ action: 'select-account', accountId: 'account-1' })
  })

  it('見える店舗が2件以上なら統括へ移動する', () => {
    expect(decideRootLanding(false, null, ['account-1', 'account-2']))
      .toEqual({ action: 'go-hq' })
  })

  it('選択済みなら店舗ダッシュボードを表示する', () => {
    expect(decideRootLanding(false, 'account-2', ['account-1', 'account-2']))
      .toEqual({ action: 'show-dashboard' })
  })
})

describe('統括から店舗画面を開く', () => {
  it('4つの許可済み遷移先を1か所で管理する', () => {
    expect(HQ_OPEN_TARGETS).toEqual({
      tags: { label: 'タグ', destination: '/tags' },
      templates: { label: 'テンプレート管理', destination: '/templates' },
      'rich-menus': { label: 'リッチメニュー管理', destination: '/rich-menus' },
      'form-submissions': { label: '回答フォーム管理', destination: '/form-submissions' },
    })
    expect(hqOpenHref('templates')).toBe('/hq/open?target=templates')
  })

  it('許可済みtargetだけを解決する', () => {
    expect(resolveHqOpenTarget('templates')).toEqual({
      key: 'templates',
      label: 'テンプレート管理',
      destination: '/templates',
    })
    expect(resolveHqOpenTarget('https://example.com')).toBeNull()
    expect(resolveHqOpenTarget('../friends')).toBeNull()
    expect(resolveHqOpenTarget(null)).toBeNull()
  })
})

describe('認証後の前回選択解除', () => {
  it('同じ認証セッションで一度だけ保存値を消す', () => {
    const local = storage({ [ACCOUNT_SELECTION_KEY]: 'old-account' })
    const session = storage()
    expect(clearSelectionAfterAuthentication(local, session)).toBe(true)
    expect(local.getItem(ACCOUNT_SELECTION_KEY)).toBeNull()
    expect(session.getItem(AUTH_SELECTION_CLEARED_KEY)).toBe('1')

    local.setItem(ACCOUNT_SELECTION_KEY, 'current-account')
    expect(clearSelectionAfterAuthentication(local, session)).toBe(false)
    expect(local.getItem(ACCOUNT_SELECTION_KEY)).toBe('current-account')
  })
})

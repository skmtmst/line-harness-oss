import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_SELECTION_KEY,
  AUTH_SELECTION_CLEARED_KEY,
  HQ_OPEN_TARGETS,
  clearSelectionAfterAuthentication,
  decideRootLanding,
  hqOpenHref,
  resolveHqOpenTarget,
  resolveStoreReturnPath,
  storeSelectionHref,
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
  it('ログインし直しでは一度だけ保存値を消す', () => {
    // ログイン画面が印を外したあと（= localStorage に印が無い）、
    // 次の認証確認で一度だけ前回の店舗選択を捨てる。
    const local = storage({ [ACCOUNT_SELECTION_KEY]: 'old-account' })
    expect(clearSelectionAfterAuthentication(local)).toBe(true)
    expect(local.getItem(ACCOUNT_SELECTION_KEY)).toBeNull()
    expect(local.getItem(AUTH_SELECTION_CLEARED_KEY)).toBe('1')

    local.setItem(ACCOUNT_SELECTION_KEY, 'current-account')
    expect(clearSelectionAfterAuthentication(local)).toBe(false)
    expect(local.getItem(ACCOUNT_SELECTION_KEY)).toBe('current-account')
  })

  it('新規タブ・再読込では他タブの選択を消さない', () => {
    // 印は共有の localStorage に残る。タブごとの sessionStorage が
    // 空になる新規タブでも、印が残っている限り選択を消さない（NEXT-07）。
    const local = storage({
      [ACCOUNT_SELECTION_KEY]: 'account-1',
      [AUTH_SELECTION_CLEARED_KEY]: '1',
    })
    expect(clearSelectionAfterAuthentication(local)).toBe(false)
    expect(local.getItem(ACCOUNT_SELECTION_KEY)).toBe('account-1')
  })
})

describe('店舗選択から元の画面へ戻る', () => {
  it('アプリ内の店舗画面パスだけを戻り先にする', () => {
    expect(resolveStoreReturnPath('/line-notifications/edit?id=1')).toBe('/line-notifications/edit?id=1')
    expect(resolveStoreReturnPath('/friends#top')).toBe('/friends#top')
    expect(resolveStoreReturnPath('/friends')).toBe('/friends')
  })

  it('外部URL・店舗不要の画面・空は戻り先にしない', () => {
    expect(resolveStoreReturnPath('https://example.com/x')).toBeNull()
    expect(resolveStoreReturnPath('//evil.example')).toBeNull()
    expect(resolveStoreReturnPath('javascript:alert(1)')).toBeNull()
    expect(resolveStoreReturnPath('/hq')).toBeNull()
    expect(resolveStoreReturnPath('/hq/open?target=tags')).toBeNull()
    expect(resolveStoreReturnPath('/login')).toBeNull()
    expect(resolveStoreReturnPath(null)).toBeNull()
    expect(resolveStoreReturnPath('')).toBeNull()
  })

  it('戻り先付きの店舗一覧URLを組み立てる', () => {
    expect(storeSelectionHref('/line-notifications/edit?id=1'))
      .toBe(`/hq?return=${encodeURIComponent('/line-notifications/edit?id=1')}`)
    expect(storeSelectionHref(null)).toBe('/hq')
    expect(storeSelectionHref('/hq')).toBe('/hq')
    expect(storeSelectionHref('https://example.com')).toBe('/hq')
  })
})

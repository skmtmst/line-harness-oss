import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const editPage = readFileSync(resolve(root, 'src/app/tags/searches/edit/page.tsx'), 'utf8')
const friendsPage = readFileSync(resolve(root, 'src/app/friends/page.tsx'), 'utf8')
const advanced = readFileSync(resolve(root, 'src/components/friends/advanced-search-dialog.tsx'), 'utf8')
const list = readFileSync(resolve(root, 'src/components/friend-fields/saved-search-list.tsx'), 'utf8')

describe('V6 保存した検索の画面契約', () => {
  it('XBkiQを既存の保存APIへ接続する', () => {
    expect(editPage).toContain('data-design-node="XBkiQ"')
    expect(editPage).toContain('api.savedSearches.update')
    expect(editPage).toContain('api.savedSearches.create')
    expect(editPage).toContain('api.savedSearches.delete')
    expect(editPage).toContain('api.friends.list')
    expect(editPage).toContain('すべて満たす')
    expect(editPage).toContain('いずれか1つ以上満たす')
  })

  it('保存と呼び出しをブラウザ1台だけのlocalStorageへ戻さない', () => {
    expect(advanced).toContain('api.savedSearches.create')
    expect(friendsPage).toContain('api.savedSearches.list')
    expect(advanced + friendsPage).not.toContain("localStorage.setItem('friends.savedSearch'")
    expect(advanced + friendsPage).not.toContain("localStorage.getItem('friends.savedSearch'")
  })

  it('一覧の適用リンクと編集リンクを分ける', () => {
    expect(list).toContain('/friends?savedSearch=')
    expect(list).toContain('/tags/searches/edit?id=')
    expect(list).toContain('条件を確認・編集')
  })

  it('条件は共通の日本語変換を使い、内部の演算子や値を直書きしない', () => {
    expect(list).toContain('describeSavedCondition')
    expect(list).toContain('api.supportMarks.list(accountId)')
    expect(list).toContain('api.scenarios.list({ accountId })')
    expect(list).not.toContain('function describeOne')
    expect(list).not.toContain("parts.map(String).join(' ')")
  })

  it('該当人数と使用先を正データで表示し、使用中は削除を止める', () => {
    expect(list).toContain('search.matchCount')
    expect(list).toContain('search.usedIn')
    expect(list).toContain('search.canDelete !== true')
    expect(editPage).toContain('original.usedIn')
    expect(editPage).toContain('original.canDelete !== true')
    expect(editPage).toContain('使用先が無いことをサーバーで確認済みです')
    expect(editPage).not.toContain('一斉配信「VIP未契約案内」')
    expect(editPage).not.toContain('オートメーション「3日後フォロー」')
  })

  it('読込失敗を空状態や別アカウントの前回データと混ぜない', () => {
    expect(list).toContain('const loadSequence = useRef(0)')
    expect(list).toContain("setLoadError('')")
    expect(list).toContain('setItems([])')
    expect(list).toContain('kind="error"')
    expect(list).toContain('保存した検索を再読み込み')
    expect(list.indexOf('loadError ?')).toBeLessThan(list.indexOf('items.length === 0'))
  })
})

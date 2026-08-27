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

  it('取得口の無い使用先件数を作らない', () => {
    expect(editPage).toContain('取得口の接続後に表示します')
    expect(editPage).not.toContain('一斉配信「VIP未契約案内」')
    expect(editPage).not.toContain('オートメーション「3日後フォロー」')
  })
})

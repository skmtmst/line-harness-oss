import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  readFriendsListSnapshot,
  writeFriendsListSnapshot,
  type FriendsListSnapshot,
} from './list-state'

/*
 * IDEA-03「3ページ以上の移動と戻る操作で条件・位置を保持」。
 * 一覧の絞り込みとページを sessionStorage へ写し、一覧へ戻ったとき
 * 同じ状態を復元する。アカウントごとにキーを分ける。
 */

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

let store: MemoryStorage

const SNAPSHOT: FriendsListSnapshot = {
  searchInput: 'たなか',
  searchSubmitted: 'たなか',
  selectedTagId: 'tag-1',
  responseFilter: 'unhandled',
  operatorId: 'op-1',
  scenarioId: 'sc-1',
  attentionOnly: true,
  sortMode: 'oldest',
  page: 3,
  pageSize: 30,
  advanced: null,
}

beforeEach(() => {
  store = new MemoryStorage()
  // list-state.ts は window.sessionStorage を見る（SSRで window が無い環境を許容するため）。
  vi.stubGlobal('window', { sessionStorage: store })
})

describe('条件・位置の保存と復元', () => {
  it('保存した条件とページをそのまま読み戻せる', () => {
    writeFriendsListSnapshot('account-a', SNAPSHOT)
    expect(readFriendsListSnapshot('account-a')).toEqual(SNAPSHOT)
  })

  it('3ページ目以降の位置（page:3 以降）も復元対象', () => {
    writeFriendsListSnapshot('account-a', { ...SNAPSHOT, page: 5 })
    expect(readFriendsListSnapshot('account-a')?.page).toBe(5)
  })

  it('別アカウントの保存値は読まない（条件の混在を防ぐ）', () => {
    writeFriendsListSnapshot('account-a', SNAPSHOT)
    expect(readFriendsListSnapshot('account-b')).toBeNull()
  })

  it('アカウント未確定（空ID）では読み書きしない', () => {
    writeFriendsListSnapshot('', SNAPSHOT)
    expect(readFriendsListSnapshot('')).toBeNull()
    expect(store.length).toBe(0)
  })
})

describe('壊れた・古い保存値', () => {
  it('JSONが壊れていても null を返す（例外で画面を止めない）', () => {
    store.setItem('lh_friends_list_state_v1:account-a', '{broken')
    expect(readFriendsListSnapshot('account-a')).toBeNull()
  })

  it('形が違う値は null を返す（そのまま適用しない）', () => {
    store.setItem('lh_friends_list_state_v1:account-a', JSON.stringify({ page: 'three' }))
    expect(readFriendsListSnapshot('account-a')).toBeNull()
  })

  it('ページ番号が範囲外・件数が選択肢外なら採用しない', () => {
    store.setItem(
      'lh_friends_list_state_v1:account-a',
      JSON.stringify({ ...SNAPSHOT, page: 0 }),
    )
    expect(readFriendsListSnapshot('account-a')).toBeNull()
    store.setItem(
      'lh_friends_list_state_v1:account-a',
      JSON.stringify({ ...SNAPSHOT, pageSize: 999 }),
    )
    expect(readFriendsListSnapshot('account-a')).toBeNull()
  })
})

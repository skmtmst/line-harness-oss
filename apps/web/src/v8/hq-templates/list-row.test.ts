import { describe, expect, it } from 'vitest'
import { distributedAccountsLine, templateSubLine } from './list-row'

describe('統括のひな形一覧の行（絵 LRc93）', () => {
  it('名前の下は内容の要約を出し、無ければ説明、それも無ければ種類名', () => {
    expect(templateSubLine({ content_summary: '本文・画像 1', description: '古い説明' }, 'テンプレート')).toBe('本文・画像 1')
    expect(templateSubLine({ content_summary: null, description: '古い説明' }, 'テンプレート')).toBe('古い説明')
    expect(templateSubLine({ content_summary: null, description: null }, 'リッチメニュー')).toBe('リッチメニュー')
    expect(templateSubLine({ description: null }, 'タグ')).toBe('タグ')
  })

  it('配布先の2行目は名前を「・」でつなぎ、4件目からは「ほか N」', () => {
    expect(distributedAccountsLine({ distributed_account_names: ['本店', '渋谷店', 'イベント'], distributed_account_more: 0 })).toBe('本店・渋谷店・イベント')
    expect(distributedAccountsLine({ distributed_account_names: ['本店'], distributed_account_more: 0 })).toBe('本店')
    expect(distributedAccountsLine({ distributed_account_names: ['本店', '渋谷店', 'イベント'], distributed_account_more: 2 })).toBe('本店・渋谷店・イベント ほか 2')
  })

  it('配っていない・名前の無い古い返事では2行目を出さない', () => {
    expect(distributedAccountsLine({ distributed_account_names: [], distributed_account_more: 0 })).toBeNull()
    expect(distributedAccountsLine({})).toBeNull()
  })
})

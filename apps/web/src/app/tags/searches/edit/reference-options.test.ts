import { describe, expect, it } from 'vitest'

import { optionsWithCurrent } from './reference-options'

describe('保存した検索の参照先候補', () => {
  const OPTIONS = [{ value: 'known-1', label: '予約問い合わせ' }]

  it('取得できた参照先は名前で選べる', () => {
    expect(optionsWithCurrent(OPTIONS, 'known-1', '選択済み', '選んでください')).toEqual([
      { value: '', label: '選んでください' },
      { value: 'known-1', label: '予約問い合わせ' },
    ])
  })

  it('一覧から取れない現在値を消さず、内部IDも表示しない', () => {
    const rows = optionsWithCurrent(OPTIONS, 'internal-id-9', '選択済みの対応マーク', '選んでください')

    expect(rows).toContainEqual({ value: 'internal-id-9', label: '選択済みの対応マーク' })
    expect(rows.map((row) => row.label)).not.toContain('internal-id-9')
  })
})

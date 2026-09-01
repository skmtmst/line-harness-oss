import { describe, expect, it } from 'vitest'
import type { CommonVar } from '@line-crm/shared'
import {
  CSV_BLOCKED_REASON,
  DELETE_MOVED_NOTE,
  IMPACT_CARDS,
  IMPACT_LIST_COUNT_TEXT,
  IMPACT_LIST_REASON,
  NOT_CONNECTED_REASON,
  NOT_CONNECTED_VALUE,
  saveBlockedReason,
} from './change-impact'

const ITEM: CommonVar = {
  id: 'cv-1',
  lineAccountId: 'acc-1',
  folderId: null,
  name: '会社名',
  varKey: 'company_name',
  type: 'text',
  value: '株式会社ネン',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

describe('変える前に影響を見る（設計 uNBlA）', () => {
  it('未接続を実値の0と混ぜない', () => {
    /*
      `0件` と書くと「どこにも差し込まれていない」と読まれ、確かめずに
      保存される。差し込んでいる場所が15か所あっても同じ絵になる。
    */
    expect(NOT_CONNECTED_VALUE).toBe('—')
    expect(NOT_CONNECTED_VALUE).not.toMatch(/0/)
    expect(IMPACT_LIST_COUNT_TEXT).not.toBe('0件')
    expect(IMPACT_LIST_COUNT_TEXT).toContain('—')
  })

  it('未接続の理由は決めた言い回しで書く', () => {
    for (const text of [NOT_CONNECTED_REASON, IMPACT_LIST_REASON, CSV_BLOCKED_REASON]) {
      expect(text).toContain('まだ繋がっていません')
      // 読込中・取得失敗・権限不足の言葉を混ぜない。次にすることが違う。
      expect(text).not.toContain('読み込んでいます')
      expect(text).not.toContain('読み込めませんでした')
      expect(text).not.toContain('権限')
    }
    expect(NOT_CONNECTED_REASON).toContain('接続されると表示されます')
  })

  it('設計の4枚は見出しを残し、数だけ伏せる', () => {
    // 見出しごと消すと、何の数が出るはずだったのか誰も気付かなくなる。
    expect(IMPACT_CARDS).toHaveLength(4)
    expect(IMPACT_CARDS.map((card) => card.key)).toEqual([
      'usage',
      'immediate',
      'overflow',
      'sent',
    ])
    for (const card of IMPACT_CARDS) {
      expect(card.title.length).toBeGreaterThan(0)
      expect(card.note).toBe(NOT_CONNECTED_REASON)
      // 作り物の数を見出しへ紛れ込ませない。
      expect(card.title).not.toMatch(/[0-9]/)
    }
  })

  it('保存できない理由を1つずつ言う', () => {
    expect(saveBlockedReason({ item: null, accountId: 'acc-1', name: '会社名', saving: false }))
      .toContain('読み込めていません')
    expect(saveBlockedReason({ item: ITEM, accountId: null, name: '会社名', saving: false }))
      .toContain('LINEアカウント')
    expect(saveBlockedReason({ item: ITEM, accountId: 'acc-1', name: '   ', saving: false }))
      .toContain('共通情報名')
    expect(saveBlockedReason({ item: ITEM, accountId: 'acc-1', name: '会社名', saving: true }))
      .toContain('保存しています')
    expect(saveBlockedReason({ item: ITEM, accountId: 'acc-1', name: '会社名', saving: false }))
      .toBeNull()
  })

  it('削除はこの画面に置かないと書いてある', () => {
    // 使用先を数えずに DELETE を投げる口が戻ってきたら、ここで気付く。
    expect(DELETE_MOVED_NOTE).toContain('共通情報一覧')
    expect(DELETE_MOVED_NOTE).toContain('確かめてから')
  })
})

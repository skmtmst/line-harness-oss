import { describe, expect, it, vi } from 'vitest'

import { deleteReminderSelection } from './delete-reminder-selection'

describe('リマインダの一括削除', () => {
  it('途中で失敗しても残りを処理し、失敗したものだけを再試行対象にする', async () => {
    const remove = vi.fn(async (id: string) => id !== 'reminder-2')

    await expect(
      deleteReminderSelection(['reminder-1', 'reminder-2', 'reminder-3'], remove),
    ).resolves.toEqual(['reminder-2'])
    expect(remove.mock.calls.map(([id]) => id)).toEqual([
      'reminder-1',
      'reminder-2',
      'reminder-3',
    ])
  })

  it('通信例外も失敗として残し、成功済みは残さない', async () => {
    const remove = vi.fn(async (id: string) => {
      if (id === 'reminder-2') throw new Error('network')
      return true
    })

    await expect(
      deleteReminderSelection(['reminder-1', 'reminder-2'], remove),
    ).resolves.toEqual(['reminder-2'])
  })
})

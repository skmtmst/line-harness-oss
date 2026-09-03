import { describe, expect, it, vi } from 'vitest'
import { newBroadcastDraftSession, persistBroadcastDraft } from './broadcast-draft'

describe('persistBroadcastDraft', () => {
  it('最初だけ作成し、テストのやり直しと最終予約は同じ下書きを更新する', async () => {
    const create = vi.fn(async () => ({ success: true, data: { id: 'draft-1' } }))
    const update = vi.fn(async (id: string) => ({ success: true, data: { id } }))
    let session = newBroadcastDraftSession('account-1', 'key-1')

    const first = await persistBroadcastDraft(session, 'account-1', { body: '最初' }, { create, update })
    session = first.session
    const second = await persistBroadcastDraft(session, 'account-1', { body: '修正後' }, { create, update })

    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({ body: '最初' }, { idempotencyKey: 'key-1' })
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('draft-1', { body: '修正後' })
    expect(second.broadcast.id).toBe('draft-1')
  })

  it('LINEアカウントを変えたときだけ別の下書きを作る', async () => {
    const create = vi.fn(async () => ({ success: true, data: { id: 'draft-2' } }))
    const update = vi.fn(async (id: string) => ({ success: true, data: { id } }))
    const session = { accountId: 'account-1', draftId: 'draft-1', createKey: 'key-1' }

    const result = await persistBroadcastDraft(
      session,
      'account-2',
      { body: '別アカウント' },
      { create, update },
      () => 'key-2',
    )

    expect(update).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith({ body: '別アカウント' }, { idempotencyKey: 'key-2' })
    expect(result.session).toEqual({ accountId: 'account-2', draftId: 'draft-2', createKey: 'key-2' })
  })

  it('既存下書きの更新に失敗しても新しい下書きを増やさない', async () => {
    const create = vi.fn(async () => ({ success: true, data: { id: 'draft-new' } }))
    const update = vi.fn(async () => ({ success: false, data: { id: 'draft-1' }, error: '更新失敗' }))
    const session = { accountId: 'account-1', draftId: 'draft-1', createKey: 'key-1' }

    await expect(persistBroadcastDraft(
      session,
      'account-1',
      { body: '修正後' },
      { create, update },
    )).rejects.toThrow('更新失敗')
    expect(create).not.toHaveBeenCalled()
  })
})

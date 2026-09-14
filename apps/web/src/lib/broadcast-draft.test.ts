import { describe, expect, it, vi } from 'vitest'
import { newBroadcastDraftSession, persistBroadcastDraft } from './broadcast-draft'

describe('persistBroadcastDraft', () => {
  it('最初だけ作成し、テストのやり直しと最終予約は同じ下書きを更新する', async () => {
    const create = vi.fn(async () => ({ success: true, data: { id: 'draft-1', version: 1 } }))
    const update = vi.fn(async (id: string) => ({ success: true, data: { id, version: 2 } }))
    const initial = newBroadcastDraftSession('account-1', 'key-1')

    const first = await persistBroadcastDraft(initial, 'account-1', { body: '最初' }, { create, update })
    const second = await persistBroadcastDraft(first.session, 'account-1', { body: '修正後' }, { create, update })

    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({ body: '最初' }, { idempotencyKey: 'key-1' })
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('draft-1', { body: '修正後' }, 1)
    expect(second.broadcast.id).toBe('draft-1')
  })

  // #772: 新規作成直後→自動保存→連続保存で版が 1→2→3 と進む。
  it('作成・連続保存で送る版が1→2と進み、保持版も進む', async () => {
    const create = vi.fn(async () => ({ success: true, data: { id: 'draft-1', version: 1 } }))
    const update = vi.fn(async (id: string, _payload: unknown, version: number) => (
      { success: true, data: { id, version: version + 1 } }
    ))
    const session = newBroadcastDraftSession('account-1', 'key-1')

    const first = await persistBroadcastDraft(session, 'account-1', { body: '最初' }, { create, update })
    expect(first.session.version).toBe(1)
    const second = await persistBroadcastDraft(first.session, 'account-1', { body: '修正1' }, { create, update })
    expect(second.session.version).toBe(2)
    const third = await persistBroadcastDraft(second.session, 'account-1', { body: '修正2' }, { create, update })
    expect(third.session.version).toBe(3)

    expect(create).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenNthCalledWith(1, 'draft-1', { body: '修正1' }, 1)
    expect(update).toHaveBeenNthCalledWith(2, 'draft-1', { body: '修正2' }, 2)
  })

  // #772: 別編集で古くなった自動保存は送った1回で止まり、送り直さない。
  it('古い版の更新が409相当で失敗したら送り直さず新しい下書きも増やさない', async () => {
    const create = vi.fn(async () => ({ success: true, data: { id: 'draft-new', version: 1 } }))
    const update = vi.fn(async () => {
      throw new Error('別の画面で下書きが更新されました')
    })
    const session = { accountId: 'account-1', draftId: 'draft-1', version: 1, createKey: 'key-1' }

    await expect(persistBroadcastDraft(
      session,
      'account-1',
      { body: '古い自動保存' },
      { create, update },
    )).rejects.toThrow('別の画面で下書きが更新されました')
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('draft-1', { body: '古い自動保存' }, 1)
    expect(create).not.toHaveBeenCalled()
  })

  it('LINEアカウントを変えたときだけ別の下書きを作る', async () => {
    const create = vi.fn(async () => ({ success: true, data: { id: 'draft-2', version: 1 } }))
    const update = vi.fn(async (id: string) => ({ success: true, data: { id, version: 2 } }))
    const session = { accountId: 'account-1', draftId: 'draft-1', version: 2, createKey: 'key-1' }

    const result = await persistBroadcastDraft(
      session,
      'account-2',
      { body: '別アカウント' },
      { create, update },
      () => 'key-2',
    )

    expect(update).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith({ body: '別アカウント' }, { idempotencyKey: 'key-2' })
    expect(result.session).toEqual({ accountId: 'account-2', draftId: 'draft-2', version: 1, createKey: 'key-2' })
  })

  it('既存下書きの更新に失敗しても新しい下書きを増やさない', async () => {
    const create = vi.fn(async () => ({ success: true, data: { id: 'draft-new', version: 1 } }))
    const update = vi.fn(async () => ({ success: false, data: { id: 'draft-1' }, error: '更新失敗' }))
    const session = { accountId: 'account-1', draftId: 'draft-1', version: 1, createKey: 'key-1' }

    await expect(persistBroadcastDraft(
      session,
      'account-1',
      { body: '修正後' },
      { create, update },
    )).rejects.toThrow('更新失敗')
    expect(create).not.toHaveBeenCalled()
  })
})

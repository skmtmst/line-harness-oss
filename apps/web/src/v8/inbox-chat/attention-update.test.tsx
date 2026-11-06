// @vitest-environment happy-dom
import { act, renderHook, waitFor, cleanup } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type ChatDetail, type ChatListItem } from '@/lib/api'
import { useInboxActions } from './use-inbox-actions'

const fx = vi.hoisted(() => ({ request: vi.fn(), role: 'owner' as string | null }))
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), fetchApi: fx.request }))
vi.mock('@/lib/staff-role', async (original) => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => fx.role }))

const detail = (id: string) => ({ id, friendId: id, isAttention: false, notes: '' }) as ChatDetail
function mount(on = false) {
  return renderHook(() => {
    const [chatDetail, setChatDetail] = useState<ChatDetail | null>({ ...detail('a'), isAttention: on })
    const [chats, setChats] = useState([{ id: 'a', friendId: 'a', isAttention: on }, { id: 'b', friendId: 'b', isAttention: false }] as ChatListItem[])
    const [error, setError] = useState('')
    const actions = useInboxActions({ chatDetail, selectedChatId: chatDetail?.id ?? null, setChatDetail, setChats, setError, loadChatDetail: vi.fn(), loadChats: vi.fn() })
    return { ...actions, chatDetail, chats, error, setChatDetail }
  })
}
beforeEach(() => { fx.role = 'owner'; fx.request.mockReset(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('注目の変更は一覧と会話を同時に更新する', () => {
  it('保存の返事を待たず一覧にも出し、連打は保存を重ねない', async () => {
    let finish!: (value: unknown) => void
    fx.request.mockResolvedValueOnce({ success: true, data: { updatedAt: 'v1' } }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const { result } = mount()
    let saving!: Promise<void>
    await act(async () => { saving = result.current.handleAttentionUpdate() })
    expect(result.current.chatDetail?.isAttention).toBe(true)
    expect(result.current.chats.map(chat => chat.isAttention)).toEqual([true, false])
    await act(async () => { await result.current.handleAttentionUpdate() })
    expect(fx.request).toHaveBeenCalledTimes(2)
    expect(fx.request.mock.calls[1][1].body).toBe(JSON.stringify({ __attention: '1' }))
    await act(async () => { finish({ success: true }); await saving })
    expect(result.current.chats[0].isAttention).toBe(true)
  })

  it.each([500, 409])('保存失敗（%s）で元の友だちの印だけを戻し、別の会話を上書きしない', async status => {
    let fail!: (error: Error) => void
    fx.request.mockResolvedValueOnce({ success: true, data: { updatedAt: 'v1' } }).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject }))
    const { result } = mount()
    let saving!: Promise<void>
    await act(async () => { saving = result.current.handleAttentionUpdate() })
    await act(async () => { result.current.setChatDetail(detail('b')) })
    await act(async () => { fail(new ApiError(status, '保存できません')); await saving })
    expect(result.current.chatDetail?.id).toBe('b')
    expect(result.current.chatDetail?.isAttention).toBe(false)
    expect(result.current.chats.map(chat => chat.isAttention)).toEqual([false, false])
    await waitFor(() => expect(result.current.error).toContain(status === 409 ? 'ほかの変更が先に保存' : '注目の変更に失敗'))
  })

  it('注目を外すと一覧と会話の両方から印を消し、友だちの保存値も外す', async () => {
    fx.request.mockResolvedValue({ success: true, data: { updatedAt: 'v1' } })
    const { result } = mount(true)
    await act(async () => { await result.current.handleAttentionUpdate() })
    expect(result.current.chatDetail?.isAttention).toBe(false)
    expect(result.current.chats[0].isAttention).toBe(false)
    expect(fx.request.mock.calls[1][1].body).toBe(JSON.stringify({ __attention: null }))
  })

  it.each(['viewer', null])('閲覧のみ・本人未確認（%s）は書き込まない', async role => {
    fx.role = role
    const { result } = mount()
    await act(async () => { await result.current.handleAttentionUpdate() })
    expect(fx.request).not.toHaveBeenCalled()
    expect(result.current.chats[0].isAttention).toBe(false)
  })
})

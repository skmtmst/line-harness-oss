import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '@/lib/api'
import { ManualPublishAttempt } from '../../../v8/rich-menus/edit/manual-publish-attempt'
import { publishMenuNow } from '../../../v8/rich-menus/new/create-publish-actions'
import { saveMenuDraft } from '../../../v8/rich-menus/new/create-save-actions'
import type { Group } from '../../../v8/rich-menus/new/create-types'

vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, richMenuGroups: { ...actual.api.richMenuGroups, publish: vi.fn(), get: vi.fn() } } }
})
vi.mock('@/components/shared/toast', () => ({ notifyToast: vi.fn(), notifySaved: vi.fn() }))

const group: Group = {
  id: 'menu-1', accountId: 'account-1', name: 'メニュー', chatBarText: 'メニュー',
  size: 'large', defaultPageId: null, isDefaultForAll: true, status: 'draft',
  targetingCondition: null, targetingPriority: 1, targetingEnabled: false,
  folderId: null, defaultOpen: false, version: 1, pages: [],
}
const publish = vi.mocked(api.richMenuGroups.publish)
beforeEach(() => vi.clearAllMocks())

function publishContext(): Parameters<typeof publishMenuNow>[0] {
  return {
    audience: 'all', group, loadChecks: vi.fn(async () => {}), persistDraft: vi.fn(async () => {}),
    publishAttempt: { current: new ManualPublishAttempt() }, publishing: false,
    reloadGroup: vi.fn(async () => {}), saveErrors: { capture: vi.fn(() => false) }, saving: false,
    setDone: vi.fn(), setError: vi.fn(), setNotice: vi.fn(), setPublishing: vi.fn(),
  }
}

describe('分割したリッチメニューの失敗処理', () => {
  it('公開が500で失敗しても保存済みの下書きを残し、同じ鍵で再試行する', async () => {
    publish.mockRejectedValue(new ApiError(500, 'API error: 500'))
    const state = publishContext()
    await publishMenuNow(state)
    expect(state.setError).toHaveBeenLastCalledWith(expect.stringContaining('下書きは保存済みです'))
    expect(state.setDone).not.toHaveBeenCalled()
    expect(state.setPublishing).toHaveBeenLastCalledWith(false)
    const key = publish.mock.calls[0][1]
    await publishMenuNow(state)
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish.mock.calls[1][1]).toBe(key)
    expect(state.setError).not.toHaveBeenCalledWith('API error: 500')
  })

  it.each([
    ['出す相手の条件を設定してください。', '出す相手の条件を設定してください。'],
    ['targetingPriority must be an integer', '出す順番は1以上の整数で入力してください。小数は使えません。'],
  ])('公開時の入力の直し方を残す（%s）', async (message, expected) => {
    publish.mockRejectedValue(new Error(message))
    const state = publishContext()
    await publishMenuNow(state)
    expect(state.setError).toHaveBeenLastCalledWith(expected)
  })

  it('下書き保存が500で失敗したら失敗を返し、保存中を解除する', async () => {
    const state: Parameters<typeof saveMenuDraft>[0] = {
      createDraft: vi.fn(async () => true), group, host: undefined,
      persistDraft: vi.fn(async () => { throw new ApiError(500, 'API error: 500') }),
      reloadGroup: vi.fn(async () => {}), saveErrors: { capture: vi.fn(() => false) }, saving: false,
      setCompareOpen: vi.fn(), setConflict: vi.fn(), setConflictLatest: vi.fn(),
      setError: vi.fn(), setNotice: vi.fn(), setSaving: vi.fn(), validateBasics: () => true,
    }
    expect(await saveMenuDraft(state)).toBe(false)
    expect(state.setError).toHaveBeenLastCalledWith(expect.stringContaining('下書きの保存に失敗しました'))
    expect(state.setError).not.toHaveBeenCalledWith('API error: 500')
    expect(state.setSaving).toHaveBeenLastCalledWith(false)
    expect(state.setConflict).not.toHaveBeenCalled()
  })

  it('新規作成の409は存在しないメニューを取り直さず、失敗と入力を保持する', async () => {
    const state: Parameters<typeof saveMenuDraft>[0] = {
      createDraft: vi.fn(async () => { throw new ApiError(409, 'API error: 409') }), group: null, host: undefined,
      persistDraft: vi.fn(async () => {}), reloadGroup: vi.fn(async () => {}),
      saveErrors: { capture: vi.fn(() => false) }, saving: false,
      setCompareOpen: vi.fn(), setConflict: vi.fn(), setConflictLatest: vi.fn(),
      setError: vi.fn(), setNotice: vi.fn(), setSaving: vi.fn(), validateBasics: () => true,
    }
    expect(await saveMenuDraft(state)).toBe(false)
    expect(state.setConflict).not.toHaveBeenCalled()
    expect(state.setConflictLatest).not.toHaveBeenCalled()
    expect(api.richMenuGroups.get).not.toHaveBeenCalled()
    expect(state.persistDraft).not.toHaveBeenCalled()
    expect(state.reloadGroup).not.toHaveBeenCalled()
    expect(state.setError).toHaveBeenLastCalledWith(expect.any(String))
    expect(state.setSaving).toHaveBeenLastCalledWith(false)
  })

  it('409では入力を書き換えず、競合の帯と比較用の最新データを用意する', async () => {
    const latest = { ...group, version: 2 }
    vi.mocked(api.richMenuGroups.get).mockResolvedValue({ success: true, data: latest })
    const state: Parameters<typeof saveMenuDraft>[0] = {
      createDraft: vi.fn(async () => true), group, host: undefined,
      persistDraft: vi.fn(async () => { throw new ApiError(409, 'API error: 409') }),
      reloadGroup: vi.fn(async () => {}), saveErrors: { capture: vi.fn(() => false) }, saving: false,
      setCompareOpen: vi.fn(), setConflict: vi.fn(), setConflictLatest: vi.fn(),
      setError: vi.fn(), setNotice: vi.fn(), setSaving: vi.fn(), validateBasics: () => true,
    }
    expect(await saveMenuDraft(state)).toBe(false)
    expect(state.setConflict).toHaveBeenCalledWith(true)
    expect(state.setCompareOpen).toHaveBeenCalledWith(false)
    expect(state.setConflictLatest).toHaveBeenCalledWith(latest)
    expect(state.reloadGroup).not.toHaveBeenCalled()
    expect(state.setNotice).not.toHaveBeenCalledWith('下書きを保存しました。')
    expect(state.setSaving).toHaveBeenLastCalledWith(false)
  })
})

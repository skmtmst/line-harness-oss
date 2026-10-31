// @vitest-environment happy-dom
import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { useFriendInfoTags } from './use-friend-info-tags'
const api = vi.hoisted(() => ({ remove: vi.fn() }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    tags: { ...actual.api.tags, list: async () => ({ success: true, data: [] }) },
    friends: { ...actual.api.friends, removeTag: api.remove },
  } }
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
function Host() {
  const [open, setOpen] = useState(true)
  const [tags, setTags] = useState<Array<{ id: string; name: string; color: string }> | undefined>([])
  const [, setSaving] = useState(false)
  const actions = useFriendInfoTags({ friendId: 'friend', accountId: 'account', targetKey: 'account:friend', effectiveTags: tags,
    setLocalTags: setTags, setMemoSaving: setSaving, beginChange: () => () => true })
  return <ConfirmDialog open={open} title="タグを外しますか？" confirmLabel="外す" onCancel={() => setOpen(false)}
    onSuccess={() => setOpen(false)} onConfirm={() => actions.removeTagById('already-removed')} />
}
it('確認中に既に外れていたタグは、送信0で成功として窓を閉じる', async () => {
  render(<Host />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '外す' })) })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(api.remove).not.toHaveBeenCalled()
})

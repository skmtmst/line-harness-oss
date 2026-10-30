// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { ComponentProps } from 'react'
const fixture = vi.hoisted(() => ({ picker: {} as { canPick?: boolean; lockedReason?: string; channel?: string }, reason: undefined as string | undefined }))
vi.mock('@/components/chats/template-picker', () => ({ default: (props: typeof fixture.picker) => { fixture.picker = props; return null } }))
vi.mock('@/components/shared/use-permission-lock-reason', () => ({ usePermissionLockReason: () => fixture.reason }))
vi.mock('@/components/shared/sender-select', () => ({ default: () => null }))
vi.mock('./schedule-dialog', () => ({ default: () => null }))
const { default: InboxReplyComposer } = await import('./inbox-reply-composer')
type Props = ComponentProps<typeof InboxReplyComposer>
function props(role: string | null): Props {
  return {
    staffRole: role, scheduledSends: [], pendingPack: null, messageContent: '', messageLength: 0,
    pendingImage: null, pendingAttachment: null, quotedMessage: null, chatDetail: null,
    textareaRef: { current: null }, imageInputRef: { current: null }, isComposingRef: { current: false },
    memoPopoverRef: { current: null }, showTemplatePicker: true,
    setShowTemplatePicker: () => {}, setMessageContent: () => {}, selectedChatId: 'chat-1', selectedAccountId: 'acc-1',
  } as Props
}
afterEach(() => { cleanup(); fixture.reason = undefined })
it.each([['viewer', false], [null, false], ['owner', true]] as const)('返信欄から%sの選択窓へ挿入権限を配線する', (role, allowed) => {
  fixture.reason = role === 'viewer' ? '閲覧のみのため変更できません' : undefined
  render(<InboxReplyComposer {...props(role)} />)
  expect(fixture.picker).toMatchObject({ channel: 'line', canPick: allowed, lockedReason: fixture.reason })
})
it('代理の閲覧へ切り替わった理由も、開いている選択窓へ渡す', () => {
  const view = render(<InboxReplyComposer {...props('owner')} />)
  fixture.reason = '代理ログイン（閲覧）中のため変更できません'
  view.rerender(<InboxReplyComposer {...props('owner')} />)
  expect(fixture.picker.lockedReason).toBe(fixture.reason)
})

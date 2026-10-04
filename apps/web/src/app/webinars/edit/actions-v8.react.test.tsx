// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebinarEditor } from '@/lib/api'

const mocks = vi.hoisted(() => ({ actions: vi.fn(), saveActions: vi.fn(), saveEditor: vi.fn(), role: 'admin' }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => mocks.role, canManageRole: (role: string) => role === 'admin' || role === 'owner' }))
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), webinarApi: mocks }))
vi.mock('@/components/shared/select', () => ({ default: ({ value, onChange, options, ...props }: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> } & React.ComponentProps<'select'>) => <select {...props} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }))

import ActionsV8 from './actions-v8'
import { ApiError } from '@/lib/api'

const editor = { version: 3, actionPolicy: { templateBody: 'ありがとう', missingResultPolicy: 'escalate' } } as WebinarEditor
const initial = [{ id: 'action1', trigger: 'completed', actionType: 'add_tag', config: { tagId: 't1', extra: 'preserve' } }]
const onDirtyChange = vi.fn()
const onEditorChange = vi.fn()
const onActionsSaved = vi.fn()
function draw(nextEditor = editor) {
  return <ActionsV8 webinarId="w1" editor={nextEditor} onEditorChange={onEditorChange} onActionsSaved={onActionsSaved} onDirtyChange={onDirtyChange} />
}
async function save() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '視聴後アクションを保存する' })) })
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.role = 'admin'
  mocks.actions.mockResolvedValue({ data: initial })
  mocks.saveActions.mockImplementation(async (_id, actions) => ({ data: actions }))
  mocks.saveEditor.mockResolvedValue({ data: { ...editor, version: 4 } })
})
afterEach(cleanup)

describe('視聴後アクションの入力と保存', () => {
  it('入力と削除を未保存として報告し、段を切り替えても入力を残す', async () => {
    render(draw())
    await screen.findByLabelText('1件目のタグID')
    fireEvent.change(screen.getByLabelText('1件目のタグID'), { target: { value: 't2' } })
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: '未視聴' }))
    fireEvent.click(screen.getByRole('button', { name: '視聴完了', exact: true }))
    expect((screen.getByLabelText('1件目のタグID') as HTMLInputElement).value).toBe('t2')
    await save()
    expect(mocks.saveActions).toHaveBeenCalledWith('w1', [{ ...initial[0], config: { tagId: 't2', extra: 'preserve' } }])
    expect(mocks.saveEditor).not.toHaveBeenCalled()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    expect(onActionsSaved).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '1件目のアクションを外す' }))
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    await save()
    expect(mocks.saveActions).toHaveBeenLastCalledWith('w1', [])
  })

  it('メッセージだけ保存できた後の失敗は、入力を残してアクションだけ再試行する', async () => {
    mocks.saveActions.mockRejectedValueOnce(new Error('network'))
    render(draw())
    await screen.findByLabelText('1件目のタグID')
    fireEvent.change(screen.getByLabelText('1件目のタグID'), { target: { value: 't2' } })
    fireEvent.change(screen.getByLabelText('視聴完了メッセージ本文'), { target: { value: '変更後' } })
    await save()
    expect(screen.getByText(/入力を残しました/)).toBeTruthy()
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    expect((screen.getByLabelText('1件目のタグID') as HTMLInputElement).value).toBe('t2')
    await save()
    expect(mocks.saveEditor).toHaveBeenCalledTimes(1)
    expect(mocks.saveActions).toHaveBeenCalledTimes(2)
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('版が競合したらアクションを送らず両方の入力を残す', async () => {
    mocks.saveEditor.mockRejectedValueOnce(new ApiError(409, 'version_conflict'))
    render(draw())
    await screen.findByLabelText('1件目のタグID')
    fireEvent.change(screen.getByLabelText('1件目のタグID'), { target: { value: 't2' } })
    fireEvent.change(screen.getByLabelText('視聴完了メッセージ本文'), { target: { value: '変更後' } })
    await save()
    expect(mocks.saveActions).not.toHaveBeenCalled()
    expect((screen.getByLabelText('視聴完了メッセージ本文') as HTMLTextAreaElement).value).toBe('変更後')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  })

  it('他の段で保存しても未保存のメッセージを消さず最新版を使う', async () => {
    const view = render(draw())
    await screen.findByLabelText('1件目のタグID')
    fireEvent.change(screen.getByLabelText('視聴完了メッセージ本文'), { target: { value: '変更途中' } })
    view.rerender(draw({ ...editor, version: 6, actionPolicy: { ...editor.actionPolicy, templateBody: '別の段から' } }))
    expect((screen.getByLabelText('視聴完了メッセージ本文') as HTMLTextAreaElement).value).toBe('変更途中')
    await save()
    expect(mocks.saveEditor).toHaveBeenCalledWith('w1', { expectedVersion: 6, actionTemplateBody: '変更途中', missingResultPolicy: 'escalate' })
  })

  it('閲覧のみでは入力と保存を止める', async () => {
    mocks.role = 'staff'
    render(draw())
    await screen.findByLabelText('1件目のタグID')
    expect(screen.getByLabelText('1件目のタグID').closest('fieldset')?.disabled).toBe(true)
    await save()
    expect(mocks.saveActions).not.toHaveBeenCalled()
    expect(mocks.saveEditor).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '未視聴' }))
    expect(screen.queryByLabelText('1件目のタグID')).toBeNull()
    expect(screen.getByRole('button', { name: '未視聴' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('保存中の連打で再保存せず入力を止める', async () => {
    let finish!: (value: unknown) => void
    mocks.saveActions.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    render(draw())
    await screen.findByLabelText('1件目のタグID')
    fireEvent.change(screen.getByLabelText('1件目のタグID'), { target: { value: 't2' } })
    await save()
    expect(screen.getByLabelText('1件目のタグID').closest('fieldset')?.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /保存/ }))
    expect(mocks.saveActions).toHaveBeenCalledTimes(1)
    await act(async () => { finish({ data: initial }) })
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('取得失敗は読み直せて、取得前に保存しない', async () => {
    mocks.actions.mockRejectedValueOnce(new Error('network'))
    render(draw())
    fireEvent.click(await screen.findByRole('button', { name: 'もう一度読み込む' }))
    await screen.findByLabelText('1件目のタグID')
    expect(mocks.actions).toHaveBeenCalledTimes(2)
    expect(mocks.saveActions).not.toHaveBeenCalled()
  })
})

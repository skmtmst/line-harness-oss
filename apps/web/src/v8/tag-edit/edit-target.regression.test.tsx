// @vitest-environment happy-dom
import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fx = vi.hoisted(() => ({ account: 'A', id: 'one', definition: vi.fn(), update: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(`id=${fx.id}`) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fx.account }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn(), usePageCrumbs: vi.fn() }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, tags: { definition: fx.definition, updateDefinition: fx.update, dependencies: async () => ({ success: true, data: { friendCount: 0 } }) }, tagGroups: { list: async () => ({ success: true, data: [] }) } } }
})
vi.mock('./edit-form', () => ({ TagEditForm: ({ tag, saving, onSave }: { tag: { name: string }; saving: boolean; onSave: (values: { name: string; actions: [] }, apply: boolean) => void }) => {
  const [name, setName] = useState(tag.name)
  return <><input aria-label="下書き" value={name} disabled={saving} onChange={e => setName(e.target.value)} /><button onClick={() => onSave({ name, actions: [] }, false)}>保存</button></>
} }))
import TagEdit from './edit'
const detail = (name: string, version = 1) => ({ success: true, data: { tag: { id: fx.id, name, status: 'active', version }, automation: null } })
const deferred = () => { let resolve!: (v: unknown) => void; let reject!: (v: unknown) => void; const promise = new Promise<unknown>((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
beforeEach(() => { fx.account='A';fx.id='one';fx.definition.mockReset();fx.update.mockReset() })
afterEach(cleanup)
it('切替先の失敗後も古いタグを編集できない（WEB088）', async () => {
  fx.definition.mockResolvedValueOnce(detail('Aのタグ')).mockRejectedValueOnce(new Error('down'))
  const view=render(<TagEdit />); await screen.findByDisplayValue('Aのタグ')
  fx.account='B';fx.id='two';view.rerender(<TagEdit />)
  await screen.findByText('タグを読み込めませんでした')
  expect(screen.queryByDisplayValue('Aのタグ')).toBeNull()
})
it('後から届いた前の対象の取得応答を捨てる（WEB088）', async () => {
  const old=deferred();fx.definition.mockReturnValueOnce(old.promise).mockResolvedValueOnce(detail('Bのタグ'))
  const view=render(<TagEdit />);fx.account='B';fx.id='two';view.rerender(<TagEdit />)
  await screen.findByDisplayValue('Bのタグ')
  await act(async()=>old.resolve({ success:true,data:{ tag:{ id:'one',name:'Aのタグ',version:1,status:'active' },automation:null } }))
  expect(screen.queryByDisplayValue('Aのタグ')).toBeNull()
})
it('保存後の読み直し中も編集欄を外さず、入力を残す（WEB087）', async () => {
  const reload=deferred();fx.definition.mockResolvedValueOnce(detail('元の名前')).mockReturnValueOnce(reload.promise)
  fx.update.mockResolvedValue({ success:true,data:{ queued:0 } })
  render(<TagEdit />);const input=await screen.findByLabelText('下書き')
  fireEvent.change(input,{ target:{ value:'保存する名前' } });fireEvent.click(screen.getByText('保存'))
  await act(async()=>{ await Promise.resolve();await Promise.resolve() })
  expect(screen.getByLabelText('下書き')).toBe(input)
  await act(async()=>reload.resolve(detail('保存する名前',2)))
  expect(screen.getByLabelText('下書き')).toBe(input)
})

it('A→B→A の古い保存完了で新しい保存中の入力を解放しない（WEB088）', async () => {
  const oldSave=deferred(), newSave=deferred()
  fx.definition.mockImplementation(async()=>detail(`${fx.account}のタグ`))
  fx.update.mockReturnValueOnce(oldSave.promise).mockReturnValueOnce(newSave.promise)
  const view=render(<TagEdit />);await screen.findByDisplayValue('Aのタグ')
  fireEvent.click(screen.getByText('保存'))
  fx.account='B';fx.id='two';view.rerender(<TagEdit />);await screen.findByDisplayValue('Bのタグ')
  fx.account='A';fx.id='one';view.rerender(<TagEdit />);await screen.findByDisplayValue('Aのタグ')
  fireEvent.click(screen.getByText('保存'))
  await act(async()=>oldSave.resolve({success:true,data:{queued:0}}))
  expect((screen.getByLabelText('下書き') as HTMLInputElement).disabled).toBe(true)
  await act(async()=>newSave.resolve({success:true,data:{queued:0}}))
})

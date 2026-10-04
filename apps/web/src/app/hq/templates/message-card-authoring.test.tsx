// @vitest-environment happy-dom
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import TemplateDefinitionEditor, { definitionError, definitionForName, freshDefinition } from './template-definition-editor'
import { loadCreationAttempt, persistCreationAttempt } from '@/lib/hq-template-create-attempt'
import { hqTemplatesApi } from '@/lib/hq-templates-api'
import type { MessageTemplateDefinition } from '@/lib/hq-templates-api'
vi.mock('@/lib/hq-templates-api', () => ({ hqTemplatesApi: { messageReferences: vi.fn(), uploadImage: vi.fn() } }))
let captured: MessageTemplateDefinition
function Harness() {
  const [value, setValue] = useState(definitionForName('template',freshDefinition('template'),'案内','') as MessageTemplateDefinition)
  captured = value
  return <TemplateDefinitionEditor type="template" value={value} disabled={false} onChange={next => setValue(next as MessageTemplateDefinition)} />
}
afterEach(() => { cleanup(); delete document.documentElement.dataset.theme; window.sessionStorage.clear(); vi.clearAllMocks() })
test('V8 titles and four button types save together and restore after an uncertain outcome', async () => {
  document.documentElement.dataset.theme = 'v8'
  vi.mocked(hqTemplatesApi.messageReferences).mockResolvedValue([{kind:'form',id:'form-source',name:'回答',accountName:'本店'},{kind:'scenario',id:'scenario-source',name:'案内',accountName:'本店'}])
  render(<Harness />)
  fireEvent.change(screen.getByLabelText('ひな形のタイトル'),{target:{value:'新商品'}})
  fireEvent.change(screen.getByLabelText('配信する本文'),{target:{value:'本文'}})
  fireEvent.change(screen.getByLabelText('ひな形の形式'),{target:{value:'flex'}})
  await waitFor(() => expect(hqTemplatesApi.messageReferences).toHaveBeenCalled())
  for (const action of ['url','message','form','scenario']) {
    fireEvent.click(screen.getByRole('button',{name:'ボタンを追加'}))
    const n = captured.card!.buttons.length
    fireEvent.change(screen.getByLabelText(`ボタン${n}の文字`),{target:{value:'開く'}})
    fireEvent.change(screen.getByLabelText(`ボタン${n}を押したとき`),{target:{value:action}})
    if(action === 'form' || action === 'scenario') {
      await screen.findByRole('option',{name:action === 'form' ? '回答（本店）' : '案内（本店）'})
      fireEvent.change(screen.getByLabelText(`ボタン${n}の参照先`),{target:{value:`${action}-source`}})
    } else fireEvent.change(screen.getByLabelText(`ボタン${n}の内容`),{target:{value:action === 'url' ? 'https://example.com' : '問い合わせ'}})
    expect(definitionError('template',captured)).toBeNull()
    if(action === 'url') fireEvent.click(screen.getByRole('button',{name:'ボタン1を外す'}))
  }
  expect(captured.card).toMatchObject({title:'新商品',body:'本文',format:'flex'})
  expect(captured.card!.buttons.map(row=>row.action)).toEqual(['message','form','scenario'])
  const scope={tenantId:'tenant',actorId:'owner'},input={type:'template' as const,name:'案内',definition:captured}
  persistCreationAttempt(window.sessionStorage,scope,'template',{requestId:'request-card',input,distribute:false})
  expect(loadCreationAttempt(window.sessionStorage,scope,'template')?.input).toEqual(input)
  expect((screen.getByRole('button',{name:'ボタンを追加'}) as HTMLButtonElement).disabled).toBe(true)
})
test('failed reference lookup preserves typed title and body on retry', async () => {
  document.documentElement.dataset.theme='v8'
  vi.mocked(hqTemplatesApi.messageReferences).mockRejectedValueOnce(new Error('offline')).mockResolvedValue([])
  render(<Harness />)
  fireEvent.change(screen.getByLabelText('配信する本文'),{target:{value:'入力を残す'}})
  fireEvent.change(screen.getByLabelText('ひな形の形式'),{target:{value:'flex'}})
  fireEvent.click(await screen.findByRole('button',{name:'参照先を再読み込み'}))
  await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull())
  expect(captured.card!.body).toBe('入力を残す')
})
test('V7 keeps the existing editor and does not load new references', () => {
  vi.mocked(hqTemplatesApi.messageReferences).mockResolvedValue([])
  render(<Harness />)
  expect(screen.getByText('LINEプレビュー')).toBeTruthy()
  expect(screen.queryByLabelText('ひな形のタイトル')).toBeNull()
  expect(hqTemplatesApi.messageReferences).not.toHaveBeenCalled()
})
test('V8 retains the existing image and carousel authoring entry', () => {
  document.documentElement.dataset.theme='v8'
  vi.mocked(hqTemplatesApi.messageReferences).mockResolvedValue([])
  render(<Harness />)
  fireEvent.click(screen.getByRole('button',{name:'画像・カルーセルの詳細編集を使う'}))
  fireEvent.click(screen.getByRole('button',{name:'メッセージ形式'}))
  expect(screen.getByRole('option',{name:'画像'})).toBeTruthy()
  expect(screen.getByRole('option',{name:'カルーセル'})).toBeTruthy()
})

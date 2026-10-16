// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Dialog from './dialog'
import Drawer from './drawer'
afterEach(cleanup)
afterEach(() => { delete document.documentElement.dataset.theme })
beforeEach(() => { document.documentElement.dataset.theme = 'v8' })
it('未保存の印を省いた引き出しでも編集を続ける・破棄するを選べる', () => {
  const close = vi.fn()
  render(<Drawer open title="電話予約を入れる" showDirtyIndicator={false} onClose={close}><input aria-label="名前" defaultValue="" /></Drawer>)
  fireEvent.change(screen.getByLabelText('名前'), { target: { value: '編集中' } })
  expect(screen.getByRole('heading', { name: '電話予約を入れる', exact: true })).toBeTruthy()
  expect(screen.getByRole('dialog', { name: '電話予約を入れる', exact: true }).dataset.dirty).toBe('true')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(close).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('dialog', { name: '入力を破棄しますか？' })).getByRole('button', { name: '編集を続ける' }))
  expect((screen.getByLabelText('名前') as HTMLInputElement).value).toBe('編集中')
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: '入力を破棄しますか？' })).getByRole('button', { name: '破棄する' }))
  expect(close).toHaveBeenCalledTimes(1)
})
it.each(['dialog', 'drawer'])('決まり1：%sの入力はEsc・外・閉じるで黙って消えない', (kind) => {
  const close = vi.fn()
  render(kind === 'dialog' ? <Dialog open dirty title="編集" onCancel={close} /> : <Drawer open dirty title="編集" onClose={close} />)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(close).not.toHaveBeenCalled()
  const confirmation = screen.getByRole('dialog', { name: '入力を破棄しますか？' })
  fireEvent.click(within(confirmation).getByRole('button', { name: '編集を続ける' }))
  expect(close).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('dialog', { name: /^編集/ })).getByRole('button', { name: '閉じる' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: '入力を破棄しますか？' })).getByRole('button', { name: '破棄する' }))
  expect(close).toHaveBeenCalledTimes(1)
})

it.each(['dialog','drawer'])('DC-UI-03 %s custom body cancel uses the common discard guard',kind=>{
 const close=vi.fn()
 const body=<><input aria-label="理由" defaultValue=""/><button onClick={close}>キャンセル</button></>
 render(kind==='dialog'?<Dialog open title="編集" onCancel={close}>{body}</Dialog>:<Drawer open title="編集" onClose={close}>{body}</Drawer>)
 fireEvent.change(screen.getByLabelText('理由'),{target:{value:'人工変更'}})
 fireEvent.click(screen.getByRole('button',{name:'キャンセル'}))
 expect(close).not.toHaveBeenCalled()
 const confirm=screen.getByRole('dialog',{name:'入力を破棄しますか？'})
 fireEvent.click(within(confirm).getByRole('button',{name:'編集を続ける'}))
 expect((screen.getByLabelText('理由') as HTMLInputElement).value).toBe('人工変更')
})

it.each(['dialog','drawer'].flatMap(kind=>['cancel','x','escape','backdrop'].map(action=>[kind,action])))('DC-UI-03 %s %s confirms the same discard', (kind,action)=>{
 const close=vi.fn()
 const body=<><input aria-label="理由" defaultValue=""/><button onClick={close}>キャンセル</button></>
 render(kind==='dialog'?<Dialog open title="編集" onCancel={close}>{body}</Dialog>:<Drawer open title="編集" onClose={close}>{body}</Drawer>)
 fireEvent.change(screen.getByLabelText('理由'),{target:{value:'人工変更'}})
 if(action==='cancel')fireEvent.click(screen.getByRole('button',{name:'キャンセル'}))
 else if(action==='x')fireEvent.click(screen.getByRole('button',{name:'閉じる'}))
 else if(action==='escape')fireEvent.keyDown(document,{key:'Escape'})
 else fireEvent.mouseDown(screen.getByRole('dialog',{name:/^編集/}).parentElement!)
 expect(close).not.toHaveBeenCalled()
 fireEvent.click(within(screen.getByRole('dialog',{name:'入力を破棄しますか？'})).getByRole('button',{name:'破棄する'}))
 expect(close).toHaveBeenCalledTimes(1)
})

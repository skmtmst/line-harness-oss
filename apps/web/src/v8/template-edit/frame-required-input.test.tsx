// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TemplateEditFrame } from './frame'
import type { TemplateEditHost } from './host'
vi.mock('@/components/shared/drawer', () => ({ default: ({ children, footer }: {children: React.ReactNode; footer: React.ReactNode}) => <div>{children}{footer}</div> }))
afterEach(cleanup)
it('未指定とundefinedは同じDOM、指定時だけ吹き出しへの挿入を止める', () => {
  const insert=vi.fn(),cancel=vi.fn()
  const host:TemplateEditHost={composer:{index:0,accountId:'a'},description:'',folders:[],folder:'',onFolderChange:vi.fn(),busy:false,onSave:vi.fn(),onCancel:cancel}
  const props={boardId:'test',title:'本文',description:'',side:null,composerHost:host,onComposerInsert:insert,children:<p>入力</p>}
  const view=render(<TemplateEditFrame {...props} />),before=view.container.innerHTML
  view.rerender(<TemplateEditFrame {...props} inputReason={undefined} />)
  expect(view.container.innerHTML).toBe(before)
  const primary=screen.getByRole('button',{name:'この吹き出しに入れる'}) as HTMLButtonElement
  fireEvent.click(primary);expect(insert).toHaveBeenCalledOnce();insert.mockClear()
  view.rerender(<TemplateEditFrame {...props} inputReason="本文を入力してください。" />)
  expect(primary.disabled).toBe(true);fireEvent.click(primary);expect(insert).not.toHaveBeenCalled()
  expect(screen.getByText('本文を入力してください。')).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'キャンセル'}));expect(cancel).toHaveBeenCalledOnce()
})

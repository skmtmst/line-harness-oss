// @vitest-environment happy-dom
import { ADD_GROUPS } from '@/v8/form-edit/model'
import type { FormInputBlock } from '@line-crm/shared'
import { cleanup,fireEvent,render,screen } from '@testing-library/react'
import { afterEach,describe,expect,it,vi } from 'vitest'
import FormFileSettings from './form-file-settings'

afterEach(cleanup)
const fileBlock: FormInputBlock = { id: 'upload', kind: 'input', type: 'file', name: 'upload', label: '添付', required: false, fileKinds: ['image', 'pdf'], fileMaxCount: 3 }

describe('受け取るファイルの設定', () => {
  it('写真とPDFを選べ、本人確認・表裏の設定を出さない', () => {
    const change = vi.fn()
    render(<FormFileSettings block={fileBlock} onChange={change} />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.queryByRole('checkbox', { name: /本人確認|表と裏/ })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'PDF' }))
    expect(change).toHaveBeenCalledWith({ fileKinds: ['image'], fileBothSides: false })
    expect(screen.getByRole('spinbutton', { name: '枚数の上限' }).getAttribute('value')).toBe('3')
    expect(ADD_GROUPS.flatMap(group => group.cards).some(card => card.key === 'identity')).toBe(false)
  })

  it.each([
    { fileKinds: ['identity'] as FormInputBlock['fileKinds'], fileBothSides: true },
    { fileKind: 'identity' as const, fileKinds: undefined, fileBothSides: true },
  ])('過去の設定を黙って写真に変えず、選び直した時だけ本人確認を外す（%j）', legacy => {
    const change = vi.fn()
    render(<FormFileSettings block={{ ...fileBlock, ...legacy }} onChange={change} />)
    expect(change).not.toHaveBeenCalled()
    expect(screen.getAllByRole('checkbox').every(input => !(input as HTMLInputElement).checked)).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('受け取れません')
    fireEvent.click(screen.getByRole('checkbox', { name: 'PDF' }))
    expect(change).toHaveBeenCalledWith({ fileKinds: ['pdf'], fileBothSides: false })
  })
})

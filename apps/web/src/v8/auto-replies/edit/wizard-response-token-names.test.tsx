// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EMPTY_FORM, type WizardForm } from './wizard-model'
import { WizardResponseStep } from './wizard-response-step'

const net = vi.hoisted(() => ({ fields: vi.fn(), vars: vi.fn() }))
vi.mock('@/lib/api', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/api')>()
  return { ...original, api: { ...original.api, friendFields: { ...original.api.friendFields, list: net.fields }, commonVars: { ...original.api.commonVars, list: net.vars } } }
})
vi.mock('@/components/auto-replies/inline-action-rows-v8', () => ({ default: () => null }))

function Host() {
  const [form, setForm] = useState<WizardForm>({ ...EMPTY_FORM, mode: 'inline-text' })
  return <><WizardResponseStep form={form} patch={part => setForm(current => ({ ...current, ...part }))} actionOptions={{ tags: [], fields: [], marks: [], scenarios: [], vars: [] }} fieldError={() => undefined} imageContent={null} matchedAccountId="account-a" templates={[]} /><output>{form.responseContent}</output></>
}

afterEach(() => { cleanup(); vi.resetAllMocks() })

it('選んだ友だち情報を同じ実名の札で表示し、2項目を区別して保存文字を保持する', async () => {
  document.documentElement.dataset.theme = 'v8'
  net.fields.mockResolvedValue({ success: true, data: [{ fieldKey: 'pet_name', name: 'ペットの名前' }, { fieldKey: 'pet_breed', name: 'ペットの種類' }] })
  net.vars.mockResolvedValue({ success: true, data: [{ varKey: 'business_hours', name: '営業時間' }] })
  const { container } = render(<Host />)
  await waitFor(() => expect((screen.getByRole('button', { name: '友だち情報', exact: true }) as HTMLButtonElement).disabled).toBe(false))
  for (const label of ['ペットの名前', 'ペットの種類']) {
    fireEvent.click(screen.getByRole('button', { name: '友だち情報', exact: true }))
    fireEvent.click(await screen.findByRole('menuitem', { name: label }))
  }
  const editor = screen.getByRole('textbox', { name: '返す文' })
  expect([...editor.querySelectorAll('[data-token]')].map(node => node.textContent)).toEqual(['ペットの名前', 'ペットの種類'])
  expect(container.querySelector('output')?.textContent).toBe('{{field.pet_name}}{{field.pet_breed}}')
  expect(editor.textContent).not.toContain('確認できません')
  expect(net.fields).toHaveBeenCalledTimes(1)
  expect(net.vars).toHaveBeenCalledTimes(1)
  delete document.documentElement.dataset.theme
})

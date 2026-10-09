// @vitest-environment happy-dom
/*
 * B-139：保存で落ちた欄は、テキスト以外（プルダウン・選ぶ欄・日付）も赤くなり、
 * タブの札に直す欄の数の赤い丸が付く。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Field } from './form-controls'
import Select from './select'
import Combobox from './combobox'
import DateField from './date-field'
import { Tabs } from './tabs'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

const noop = () => {}

describe('欄の誤りをテキスト以外の欄でも出す（B-139）', () => {
  it('Field に誤りがあると、プルダウン・選ぶ欄・日付が aria-invalid になり、理由を読み上げにつなぐ', async () => {
    await act(async () => {
      root.render(
        <div>
          <Field label="種類" htmlFor="kind" error="種類を選んでください">
            <Select id="kind" value="" onChange={noop} options={[{ value: '', label: '選ぶ' }, { value: 'a', label: 'A' }]} />
          </Field>
          <Field label="タグ" htmlFor="tag" error="タグを選んでください">
            <Combobox id="tag" value="" onChange={noop} options={[{ value: 'a', label: 'A' }]} />
          </Field>
          <Field label="日付" htmlFor="day" error="日付を選んでください">
            <DateField id="day" value="" onChange={noop} />
          </Field>
          <Field label="正しい欄" htmlFor="ok">
            <Select id="ok" value="a" onChange={noop} options={[{ value: 'a', label: 'A' }]} />
          </Field>
        </div>,
      )
    })
    for (const id of ['kind', 'tag', 'day']) {
      const control = host.querySelector(`#${id}`) as HTMLElement
      expect(control, id).toBeTruthy()
      expect(control.getAttribute('aria-invalid'), id).toBe('true')
      const describedBy = control.getAttribute('aria-describedby') ?? ''
      const reasons = describedBy.split(' ').map((ref) => document.getElementById(ref)?.textContent ?? '')
      expect(reasons.some((text) => text.includes('選んでください')), id).toBe(true)
    }
    expect(host.querySelector('#ok')?.getAttribute('aria-invalid')).toBeNull()
  })

  it('タブの札に、そのタブの直す欄の数を赤い丸で出す（0 は出さない）', async () => {
    await act(async () => {
      root.render(<Tabs items={[{ label: 'カード1', current: true, errorCount: 0, onClick: noop }, { label: 'カード2', errorCount: 2, onClick: noop }]} />)
    })
    const badges = host.querySelectorAll('[data-design-part="error-count-badge"]')
    expect(badges).toHaveLength(1)
    expect(badges[0].textContent).toBe('2')
    expect(badges[0].getAttribute('aria-label')).toBe('カード2に直す欄が2か所')
  })
})

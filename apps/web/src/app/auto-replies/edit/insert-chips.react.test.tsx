// @vitest-environment happy-dom
/*
 * 差し込みの札が入れる文字は、送るときに本当に置き換わる形でなければならない。
 * 以前は {name}・{field}・{var}・{booking_at}（自動応答）、{名前}（一斉配信 かんたんに送る）を
 * 入れていて、どれも置き換わらずにお客さまへそのまま届いていた（2026-10-07 点検）。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INTERPOLATION_RE } from '@line-crm/shared'
import AutoReplyInsertChips, { insertedLabels, NAME_TOKEN } from './insert-chips'
import { QUICK_SEND_NAME_TOKEN } from '@/v8/broadcasts/quick-send'

/** Worker の expandVariables が置き換える形（step-delivery.ts と同じ）。 */
const WORKER_FORMS = [/^\{\{name\}\}$/, /^\{\{field\.[a-z][a-z0-9_]*\}\}$/, /^\{\{\s*var\.[a-z][a-z0-9_]*\s*\}\}$/]
const resolvable = (token: string) => WORKER_FORMS.some((re) => re.test(token)) && new RegExp(INTERPOLATION_RE.source).test(token)

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

const button = (label: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement

describe('差し込みの札（自動応答・かんたんに送る）', () => {
  it('かんたんに送るの「名前」は送るときに置き換わる形', () => {
    expect(resolvable(QUICK_SEND_NAME_TOKEN)).toBe(true)
    expect(resolvable('{名前}')).toBe(false)
  })

  it('自動応答の札は置き換わる形だけを入れ、予約日時は押せない', async () => {
    const inserted: string[] = []
    const load = vi.fn(async () => ({
      friendFields: [{ fieldKey: 'pet_name', name: 'ペットの名前' }],
      commonVars: [{ varKey: 'shop_hours', name: '営業時間' }],
    })) as never
    await act(async () => {
      root.render(<AutoReplyInsertChips accountId="acc-1" load={load} onInsert={(t) => inserted.push(t)} />)
    })
    act(() => button('名前').click())
    act(() => button('友だち情報').click())
    const fieldItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) => el.textContent?.includes('ペットの名前')) as HTMLElement
    act(() => fieldItem.click())
    act(() => button('共通情報').click())
    const varItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) => el.textContent?.includes('営業時間')) as HTMLElement
    act(() => varItem.click())

    expect(inserted).toEqual([NAME_TOKEN, '{{field.pet_name}}', '{{var.shop_hours}}'])
    for (const token of inserted) expect(resolvable(token)).toBe(true)
    expect(button('予約日時').disabled).toBe(true)
    expect(insertedLabels(inserted.join(''))).toEqual(['名前', '友だち情報', '共通情報'])
  })

  it('項目が無い・読めないときは友だち情報・共通情報を押せない', async () => {
    const load = vi.fn(async () => { throw new Error('x') }) as never
    await act(async () => {
      root.render(<AutoReplyInsertChips accountId="acc-1" load={load} onInsert={() => {}} />)
    })
    expect(button('友だち情報').disabled).toBe(true)
    expect(button('共通情報').disabled).toBe(true)
    expect(button('友だち情報').title).toContain('読み込めませんでした')
  })
})

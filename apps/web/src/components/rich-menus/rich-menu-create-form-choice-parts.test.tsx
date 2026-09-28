// @vitest-environment happy-dom
/**
 * m20j: 素の radio・checkbox を共通部品（RadioCard・Checkbox）へ置き換えた契約。
 *
 * 対象はリッチメニューの作成フォーム。「出す相手」は群として1つだけ選び、
 * 「既定メニューにする」は押すたびに切り替わる。素の input に戻すと
 * group ロールがなくなり赤になる。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/shared/condition-builder', () => ({ default: () => null }))

import RichMenuCreateForm, {
  freshRichMenuCreateValue,
  type RichMenuCreateValue,
} from './rich-menu-create-form'

let host: HTMLDivElement
let root: Root
let current: RichMenuCreateValue
const onChange = vi.fn((next: RichMenuCreateValue) => {
  current = next
})

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  current = freshRichMenuCreateValue()
  onChange.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

function mount() {
  act(() => {
    root.render(<RichMenuCreateForm value={current} onChange={onChange} audienceSetup />)
  })
}

function rerender() {
  act(() => {
    root.render(<RichMenuCreateForm value={current} onChange={onChange} audienceSetup />)
  })
}

function radio(name: RegExp): HTMLInputElement {
  const hit = Array.from(host.querySelectorAll('input[type="radio"]')).find((el) =>
    el.closest('label')?.textContent?.match(name),
  )
  if (!hit) throw new Error(`ラジオが見つかりません: ${name}`)
  return hit as HTMLInputElement
}

describe('m20j: 作成フォームの選ぶ部品', () => {
  it('出す相手は群として読まれ、条件つきへ切り替えられる', async () => {
    mount()
    const legends = Array.from(host.querySelectorAll('fieldset legend')).map((el) => el.textContent)
    expect(legends).toContain('出す相手')
    const all = radio(/すべての友だち/)
    const targeted = radio(/条件に当てはまる友だちだけ/)
    expect(all.checked).toBe(true)
    await act(async () => { targeted.click() })
    expect(onChange).toHaveBeenCalled()
    expect(current.targetingEnabled).toBe(true)
    rerender()
    expect(radio(/条件に当てはまる友だちだけ/).checked).toBe(true)
    expect(radio(/すべての友だち/).checked).toBe(false)
  })

  it('既定メニューは押すたびに切り替わる', async () => {
    mount()
    const hit = Array.from(host.querySelectorAll('input[type="checkbox"]')).find((el) =>
      el.closest('label')?.textContent?.match(/既定メニューにする/),
    )
    if (!hit) throw new Error('既定メニューのチェックが見つかりません')
    const box = hit as HTMLInputElement
    expect(box.checked).toBe(current.isDefaultForAll)
    await act(async () => { box.click() })
    expect(onChange).toHaveBeenCalled()
    expect(current.isDefaultForAll).toBe(true)
  })
})

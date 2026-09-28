// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BlockEditor from './block-editor'
import { EMPTY_REFS } from './form-refs'
import type { FormBlock, FormInputType } from '@line-crm/shared'
import { newBlockId } from '@line-crm/shared'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.restoreAllMocks()
})

function mount(block: FormBlock) {
  act(() => {
    root.render(
      <BlockEditor
        block={block}
        index={0}
        sections={[]}
        refs={EMPTY_REFS}
        selected
        onSelect={() => {}}
        onChange={() => {}}
      />,
    )
  })
}

function inputBlock(type: FormInputType): FormBlock {
  return {
    id: newBlockId(),
    kind: 'input',
    type,
    name: 'q1',
    label: '質問',
  }
}

// 「初期値」の欄の中の操作部品を取り出す。
function defaultControl() {
  const label = Array.from(host.querySelectorAll('label')).find((el) =>
    el.textContent?.includes('初期値'),
  )
  if (!label) throw new Error('初期値の欄が見つかりません')
  return label
}

describe('R196 初期値はその欄の形で入れる', () => {
  it('日付は日付入力になる', () => {
    mount(inputBlock('date'))
    const control = defaultControl().querySelector('input')
    expect(control?.type).toBe('date')
  })

  it('都道府県は選択欄になり47都道府県から選べる', async () => {
    mount(inputBlock('prefecture'))
    // 共通Selectは閉じている間はボタンのみ。開いて候補を読む。
    const combo = defaultControl().querySelector('button[aria-label="初期値"]')
    expect(combo).not.toBeNull()
    // 候補は body 直下の portal に出る。開く操作は click で行う。
    await act(async () => { (combo as HTMLButtonElement).click() })
    const labels = Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.textContent)
    expect(labels).toContain('東京都')
    expect(labels).toContain('沖縄県')
    expect(labels.length).toBeGreaterThan(47)
  })

  it('複数行は改行できる入力になる', () => {
    mount(inputBlock('textarea'))
    expect(defaultControl().querySelector('textarea')).not.toBeNull()
  })

  it('単一行は従来どおり文字入力のまま', () => {
    mount(inputBlock('text'))
    const control = defaultControl().querySelector('input')
    expect(control?.type).toBe('text')
  })
})

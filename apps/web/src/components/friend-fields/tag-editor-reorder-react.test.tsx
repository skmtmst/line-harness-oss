// @vitest-environment happy-dom
/*
 * #670 28: つまみ(⋮⋮)のドラッグはマウス専用だったため、キーボードだけでは
 * 連動アクションの順番を変えられなかった。各行の「上へ」「下へ」で
 * 動かせることを、本物のReactで確かめる試験。
 *
 * 見るのは2つだけ:
 *   - 上へ・下へボタンがあり、端では押せないこと
 *   - 上へを押すと並びが入れ替わり、保存する値に届くこと
 *
 * 差し替えるのは shell のタイトルと next/link だけ。保存の口は本物の
 * onSave で受け、api は叩かない(embedded＋accountIdなしで効果を止める)。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TagEditorV4, { type LinkedAction, type TagEditorValues } from './tag-editor-v4'

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={typeof href === 'string' ? href : '#'}>{children}</a>
  ),
}))

const ACTION_A: LinkedAction = { id: 'a-1', type: 'タグ追加', label: 'AAAへ付与', timing: 'すぐに' }
const ACTION_B: LinkedAction = { id: 'b-2', type: 'テキスト送信', label: 'BBBを送信', timing: 'すぐに' }

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  act(() => {
    root?.unmount()
  })
  host?.remove()
  root = null
  host = null
})

async function renderEditor(onSave: (values: TagEditorValues) => Promise<void>) {
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    root = createRoot(host!)
    root.render(
      <TagEditorV4
        mode="create"
        groups={[]}
        embedded
        saving={false}
        onCancel={() => {}}
        onSave={onSave}
        initialValues={{ name: '順番テスト', linked: true, actions: [ACTION_A, ACTION_B] }}
      />,
    )
  })
  return host!
}

function byLabel(container: ParentNode, name: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (button) => button.getAttribute('aria-label') === name,
  )
  if (!found) throw new Error(`ボタンが無い: ${name}`)
  return found as HTMLButtonElement
}

function actionOrder(container: ParentNode): string[] {
  const list = container.querySelector('ol')
  if (!list) throw new Error('連動アクションの一覧が無い')
  return Array.from(list.querySelectorAll(':scope > li')).map((item) => item.textContent ?? '')
}

describe('連動アクションの上へ・下へ(#670 28)', () => {
  it('端の行のボタンは押せない', async () => {
    const container = await renderEditor(async () => {})
    expect(byLabel(container, '1番目のアクションを上へ').disabled).toBe(true)
    expect(byLabel(container, '1番目のアクションを下へ').disabled).toBe(false)
    expect(byLabel(container, '2番目のアクションを上へ').disabled).toBe(false)
    expect(byLabel(container, '2番目のアクションを下へ').disabled).toBe(true)
  })

  it('2番目を上へ押すと1番目と入れ替わり、保存する値に届く', async () => {
    const saved: TagEditorValues[] = []
    const container = await renderEditor(async (values) => {
      saved.push(values)
    })
    const before = actionOrder(container)
    expect(before[0]).toContain('AAAへ付与')
    expect(before[1]).toContain('BBBを送信')

    await act(async () => {
      byLabel(container, '2番目のアクションを上へ').click()
    })
    const after = actionOrder(container)
    expect(after[0]).toContain('BBBを送信')
    expect(after[1]).toContain('AAAへ付与')

    await act(async () => {
      const save = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'タグを作る',
      )
      if (!save) throw new Error('保存ボタンが無い')
      save.click()
    })
    expect(saved).toHaveLength(1)
    expect(saved[0].actions.map((action) => action.id)).toEqual(['b-2', 'a-1'])
  })
})

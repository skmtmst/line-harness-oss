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
import type { LinkedAction, TagEditorValues } from './tag-editor-v4'
import { TagEditForm } from '@/v8/tag-edit/edit-form'
import type { Tag } from '@line-crm/shared'
import { within } from '@testing-library/react'

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
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
      <TagEditForm
        tag={{ id: 't1', name: '順番テスト', linkedEnabled: true } as Tag}
        accountId="" readOnly={false} dependencies={null}
        conflict={false} compareBusy={false} onCompare={() => {}} onReloadLatest={() => {}}
        retroactiveReference={false} initialActions={[ACTION_A, ACTION_B]} onDelete={() => {}}
        groups={[]}
        saving={false}
        onCancel={() => {}}
        onSave={onSave}
      />,
    )
  })
  await act(async () => {
    const section = host!.querySelector('section[aria-label="タグ連動"]')!
    within(section as HTMLElement).getByRole('button', { name: '開く', exact: true }).click()
  })
  return host!
}

function handle(container: ParentNode, number: number) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${number}つ目の行うことを並べ替える"]`)!
}
function actionOrder(container: ParentNode): string[] {
  return Array.from(container.querySelectorAll('[data-action-row]')).map(item => item.textContent ?? '')
}
async function keyMove(container: ParentNode, number: number, key: string) {
  await act(async () => { handle(container, number).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })
}

describe('連動アクションの上へ・下へ(#670 28)', () => {
  it('端で上下キーを押しても範囲外に動かない', async () => {
    const container = await renderEditor(async () => {})
    const before = actionOrder(container)
    await keyMove(container, 1, 'ArrowUp')
    await keyMove(container, 2, 'ArrowDown')
    expect(actionOrder(container)).toEqual(before)
  })

  it('2番目を上へ押すと1番目と入れ替わり、保存する値に届く', async () => {
    const saved: TagEditorValues[] = []
    const container = await renderEditor(async (values) => {
      saved.push(values)
    })
    const before = actionOrder(container)
    expect(before[0]).toContain('AAAへ付与')
    expect(before[1]).toContain('BBBを送信')

    await keyMove(container, 2, 'ArrowUp')
    const after = actionOrder(container)
    expect(after[0]).toContain('BBBを送信')
    expect(after[1]).toContain('AAAへ付与')

    await act(async () => {
      const save = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'タグを保存する',
      )
      if (!save) throw new Error('保存ボタンが無い')
      save.click()
    })
    expect(saved).toHaveLength(1)
    expect(saved[0].actions.map((action) => action.id)).toEqual(['b-2', 'a-1'])
  })
})

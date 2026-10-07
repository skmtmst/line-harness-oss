// @vitest-environment happy-dom
/*
 * フォーム編集「答え終わったら行うこと」の並べ替え（オーナー点検 2026-10-08）。
 *
 * 直す前: 質問の行と同じ形のつまみなのに、ドラッグできず上下キーと「…」だけだった。
 * 決まり: ドラッグ・上下キー・「…」の上へ／下へは同じ結果。
 */
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormAction, FormOptions } from '@line-crm/shared'
import type { FormRefs } from '@/components/forms/form-refs'

vi.mock('@/components/forms/action-editor', () => ({ default: () => null }))

import { AfterTab } from './after-tab'

const REFS = { tags: [], templates: [], friendFields: [], scenarios: [], reminders: [] } as unknown as FormRefs
const text = (body: string) => ({ kind: 'send_text', text: body }) as unknown as FormAction

let latest: string[] = []

function Harness() {
  const [options, setOptions] = useState<FormOptions>({ afterActions: [text('A'), text('B'), text('C')] } as unknown as FormOptions)
  latest = (options.afterActions ?? []).map((action) => (action as { text: string }).text)
  return (
    <AfterTab
      options={options}
      refs={REFS}
      onSubmitTagId=""
      onChangeOptions={(next) => setOptions((current) => ({ ...current, ...next }))}
      onChangeSubmitTag={() => {}}
    />
  )
}

afterEach(cleanup)

function handleOf(body: string) {
  return screen.getByRole('button', { name: `「テキストを送る「${body}」」を並べ替える` })
}

describe('答え終わったら行うことの並べ替え', () => {
  it('ドラッグ・上下キー・「…」の下へは同じ結果になる', () => {
    const results: string[][] = []
    for (const how of ['drag', 'key', 'menu'] as const) {
      cleanup()
      const { container } = render(<Harness />)
      if (how === 'key') fireEvent.keyDown(handleOf('A'), { key: 'ArrowDown' })
      if (how === 'menu') {
        fireEvent.click(screen.getByRole('button', { name: '「テキストを送る「A」」のその他操作' }))
        fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /^下へ/ }))
      }
      if (how === 'drag') {
        const target = container.querySelector<HTMLElement>('[data-reorder-id="1"]')!
        fireEvent.dragStart(handleOf('A'))
        fireEvent.dragEnter(target)
        fireEvent.dragOver(target)
        fireEvent.drop(target)
      }
      results.push([...latest])
    }
    expect(results).toEqual([['B', 'A', 'C'], ['B', 'A', 'C'], ['B', 'A', 'C']])
  })

  it('ドラッグで離れた位置へも動かせ、先頭で上へは何もしない', () => {
    const { container } = render(<Harness />)
    const target = container.querySelector<HTMLElement>('[data-reorder-id="2"]')!
    fireEvent.dragStart(handleOf('A'))
    fireEvent.dragEnter(target)
    fireEvent.dragOver(target)
    fireEvent.drop(target)
    expect(latest).toEqual(['B', 'C', 'A'])
    fireEvent.keyDown(handleOf('B'), { key: 'ArrowUp' })
    expect(latest).toEqual(['B', 'C', 'A'])
  })
})

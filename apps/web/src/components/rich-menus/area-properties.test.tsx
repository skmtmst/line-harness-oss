// @vitest-environment happy-dom
/*
 * R19/R20: ボタンのタグ選びは共通の複数選択（★V7 WUVcz §2）。
 * - 打つと絞り込める（104件を小さな枠から探さない）
 * - まとまりの読み上げ名の入れ子がない（各項目は個別の名前だけ）
 * - 選んだタグは札で並び、札の×で外せる
 */
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AreaProperties } from './area-properties'
import type { Area } from './canvas-editor'

afterEach(() => cleanup())

const TAGS = [
  { id: 'tag-1', name: 'NEN会員' },
  { id: 'tag-2', name: '定期便' },
  { id: 'tag-3', name: '定期便提案対象' },
  { id: 'tag-4', name: 'ギフト' },
]

function Harness({ initial = [] as string[] }: { initial?: string[] }) {
  const [area, setArea] = useState<Area>({
    id: 'area-a',
    boundsX: 0,
    boundsY: 0,
    boundsWidth: 100,
    boundsHeight: 100,
    actionType: 'message',
    actionData: { text: '予約する' },
    intent: 'text',
    label: '予約する',
    tagIds: initial,
  })
  const onUpdate = vi.fn((patch: Partial<Area>) => setArea((prev) => ({ ...prev, ...patch })))
  return (
    <>
      <AreaProperties
        area={area}
        pages={[]}
        tags={TAGS}
        templates={[]}
        forms={[]}
        trackedLinks={[]}
        taps={null}
        onUpdate={onUpdate}
        showManagementDetails={false}
      />
      <span data-testid="tag-ids">{(area.tagIds ?? []).join(',')}</span>
    </>
  )
}

describe('ボタンのタグ選び（R19/R20）', () => {
  it('打つと候補が絞り込める', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'タグを付ける' }))
    fireEvent.change(screen.getByRole('searchbox', { name: /名前で探す/ }), { target: { value: '定期' } })
    const listbox = screen.getByRole('dialog')
    expect(within(listbox).getAllByRole('checkbox')).toHaveLength(2)
  })

  it('まとまりの読み上げ名の入れ子がなく、各項目は個別の名前だけ', () => {
    const { container } = render(<Harness />)
    // label の入れ子（外側 label が全タグ名を連結して読む原因）はない
    expect(container.querySelectorAll('label label')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'タグを付ける' }))
    const listbox = screen.getByRole('dialog')
    const options = within(listbox).getAllByRole('checkbox')
    expect(options).toHaveLength(4)
    // 先頭の項目名に他のタグ名が混ざらない
    expect(options[0].textContent).not.toContain('定期便')
    expect(within(listbox).getByRole('checkbox', { name: /NEN会員/ })).toBeTruthy()
  })

  it('選んだタグは札で並び、札の×で外せる', () => {
    render(<Harness initial={['tag-1']} />)
    expect(screen.getByRole('button', { name: 'NEN会員を外す' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'NEN会員を外す' }))
    expect(screen.getByTestId('tag-ids').textContent).toBe('')
  })

  it('候補は確定したあとに反映される', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'タグを付ける' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: /ギフト/ }))
    expect(screen.getByTestId('tag-ids').textContent).toBe('')
    fireEvent.click(screen.getByRole('button', { name: /この.*にする/ }))
    expect(screen.getByTestId('tag-ids').textContent).toBe('tag-4')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

function IntentHarness({ intent }: { intent: 'datetime' | 'clipboard' }) {
  const [area, setArea] = useState<Area>({
    id: 'area-b',
    boundsX: 0,
    boundsY: 0,
    boundsWidth: 100,
    boundsHeight: 100,
    actionType: intent === 'datetime' ? 'datetimepicker' : 'clipboard',
    actionData: intent === 'datetime' ? { mode: 'date' } : { text: '' },
    intent,
    label: intent === 'datetime' ? '日時を選ぶ' : 'コピーする',
  })
  const onUpdate = vi.fn((patch: Partial<Area>) => setArea((prev) => ({ ...prev, ...patch })))
  return (
    <AreaProperties
      area={area}
      pages={[]}
      tags={[]}
      templates={[]}
      forms={[]}
      trackedLinks={[]}
      taps={null}
      onUpdate={onUpdate}
      showManagementDetails={false}
    />
  )
}

describe('日時を選ぶ・文字をコピーするボタン（O）', () => {
  it('日時の種類とはじめの値を入れられる', () => {
    render(<IntentHarness intent="datetime" />)
    expect(screen.getByLabelText('日時の種類')).toBeTruthy()
    expect(screen.getByPlaceholderText('例：2026-10-01')).toBeTruthy()
  })

  it('コピーする文字を入れられる', () => {
    render(<IntentHarness intent="clipboard" />)
    expect(screen.getByPlaceholderText('例：合言葉は「さくら」')).toBeTruthy()
  })

  it('種類の選択肢に日時・コピーが増えている', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '押したときの動き' }))
    const listbox = screen.getByRole('listbox')
    expect(within(listbox).getByRole('option', { name: /日時を選ぶ/ })).toBeTruthy()
    expect(within(listbox).getByRole('option', { name: /文字をコピーする/ })).toBeTruthy()
  })
})

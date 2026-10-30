// @vitest-environment happy-dom
import { createRef, type ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fixtures = vi.hoisted(() => ({ fields: vi.fn(), vars: vi.fn(), held: {} as Record<string, () => void>, dateChange: (_next: string) => {} }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a' }) }))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ enabled: () => true }) }))
vi.mock('./scenario-reference-data', () => ({ scenarioReferenceData: { friendFields: fixtures.fields, commonVars: fixtures.vars } }))
vi.mock('@/components/shared/message-insert-row', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/shared/message-insert-row')>()
  return { ...actual, MessageInsertButton: (props: ComponentProps<typeof actual.MessageInsertButton>) => {
    fixtures.held[String(props.label)] = props.onClick
    return <actual.MessageInsertButton {...props} />
  } }
})
vi.mock('@/components/shared/date-field', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/shared/date-field')>()
  return { ...actual, default: (props: ComponentProps<typeof actual.default>) => {
    fixtures.dateChange = props.onChange
    return <actual.default {...props} />
  } }
})
import InsertToolbar from './insert-toolbar'

beforeEach(() => {
  fixtures.held = {}
  fixtures.fields.mockReset().mockResolvedValue({ success: true, data: [{ fieldKey: 'pet_name', name: 'ペット名' }] })
  fixtures.vars.mockReset().mockResolvedValue({ success: true, data: [{ varKey: 'greeting', name: 'ご挨拶' }] })
})
afterEach(cleanup)
const reason = '閲覧のみのため本文を変更できません'
function props() { return { targetRef: createRef<HTMLTextAreaElement>(), value: '本文', onChange: vi.fn(), includeAnswerForm: true, count: '2 / 4500' } }
async function loaded() { await waitFor(() => { expect(fixtures.fields).toHaveBeenCalledTimes(1); expect(fixtures.vars).toHaveBeenCalledTimes(1) }) }

it('理由がある時も差し込む全ボタンを残し、焦点の理由とクリック・Enter・Spaceの拒否を保つ', async () => {
  const p = props(), view = render(<InsertToolbar {...p} lockedReason={reason} />)
  await loaded()
  expect(screen.getByText('2 / 4500')).toBeTruthy()
  for (const name of ['名前', '友だち情報', '共通情報', '回答フォーム', '配信日', 'その他']) {
    const button = screen.getByRole('button', { name }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(button.tabIndex).toBe(0)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.focus(button)
    expect(screen.getAllByRole('tooltip').at(-1)?.textContent).toBe(reason)
    fireEvent.click(button)
    expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(false)
    expect(fireEvent.keyDown(button, { key: ' ' })).toBe(false)
    fireEvent.blur(button)
  }
  expect(p.onChange).not.toHaveBeenCalled()
  expect(view.container.querySelectorAll('[data-permission-locked]')).toHaveLength(6)
})

it('開いていた友だち情報の窓を残し、GETは読み続け、選ぶ時だけ理由付きで拒む', async () => {
  const p = props(), view = render(<InsertToolbar {...p} />)
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: '友だち情報' }))
  await screen.findByRole('button', { name: 'ペット名' })
  view.rerender(<InsertToolbar {...p} lockedReason={reason} />)
  const option = screen.getByRole('button', { name: 'ペット名' }) as HTMLButtonElement
  expect(option.disabled).toBe(false)
  expect(option.tabIndex).toBe(0)
  expect(option.getAttribute('aria-disabled')).toBe('true')
  fireEvent.focus(option)
  expect(screen.getByRole('tooltip').textContent).toBe(reason)
  fireEvent.click(option)
  expect(screen.getByRole('button', { name: 'ペット名' })).toBeTruthy()
  expect(p.onChange).not.toHaveBeenCalled()
  expect(fixtures.fields).toHaveBeenCalledTimes(1)
  expect(fixtures.vars).toHaveBeenCalledTimes(1)
})

it.each([{ label: 'disabledだけ', gate: { disabled: true } }, { label: 'callbackだけ', gate: { canChangeNow: () => false } }])('本人未確定は理由なしの普通disabled。開いた候補は閉じず変更0にする $label', async ({ gate }) => {
  const p = props(), view = render(<InsertToolbar {...p} />)
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: '友だち情報' }))
  await screen.findByRole('button', { name: 'ペット名' })
  const oldAllowed = fixtures.held['名前']
  view.rerender(<InsertToolbar {...p} {...gate} />)
  oldAllowed()
  for (const name of ['名前', '友だち情報', 'ペット名']) {
    const button = screen.getByRole('button', { name }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.hasAttribute('data-permission-locked')).toBe(false)
    fireEvent.click(button)
  }
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(p.onChange).not.toHaveBeenCalled()
  const oldDenied = fixtures.held['名前']
  view.rerender(<InsertToolbar {...p} />)
  oldDenied()
  expect(p.onChange).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '名前' }))
  expect(p.onChange).toHaveBeenCalledExactlyOnceWith('本文{{name}}')
})

it('再描画前でも権限が失効したら、名前の差し込みを止める', async () => {
  let allowed = true
  const p = props()
  render(<InsertToolbar {...p} canChangeNow={() => allowed} />)
  await loaded()
  allowed = false
  fireEvent.click(screen.getByRole('button', { name: '名前' }))
  expect(p.onChange).not.toHaveBeenCalled()
})

it('古い許可callbackは新しい拒否callbackを見て止まり、古い拒否callbackは新しい許可へ復活しない', async () => {
  const p = props(), view = render(<InsertToolbar {...p} canChangeNow={() => true} />)
  await loaded()
  const oldAllowed = fixtures.held['名前']
  view.rerender(<InsertToolbar {...p} canChangeNow={() => false} />)
  oldAllowed()
  expect(p.onChange).not.toHaveBeenCalled()
  const oldDenied = fixtures.held['名前']
  view.rerender(<InsertToolbar {...p} canChangeNow={() => true} />)
  oldDenied()
  expect(p.onChange).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '名前' }))
  expect(p.onChange).toHaveBeenCalledExactlyOnceWith('本文{{name}}')
})

it('理由だけの切替も保持した名前の操作へ反映する', async () => {
  const p = props(), view = render(<InsertToolbar {...p} />)
  await loaded()
  const old = fixtures.held['名前']
  view.rerender(<InsertToolbar {...p} lockedReason={reason} />)
  old()
  expect(p.onChange).not.toHaveBeenCalled()
})

it('指定なしは元のボタンとTab順・文字数・名前と候補の差し込みを保つ', async () => {
  const p = props(), view = render(<InsertToolbar {...p} />)
  await loaded()
  expect(view.container.querySelector('[data-permission-locked], [aria-disabled], [hidden]')).toBeNull()
  const buttons = screen.getAllByRole('button') as HTMLButtonElement[]
  expect(buttons.map(b => [b.textContent, b.disabled, b.tabIndex])).toEqual([
    ['名前', false, 0], ['友だち情報', false, 0], ['共通情報', false, 0], ['回答フォーム', false, 0], ['配信日', false, 0], ['その他', false, 0],
  ])
  fireEvent.click(screen.getByRole('button', { name: '名前' }))
  expect(p.onChange).toHaveBeenCalledExactlyOnceWith('本文{{name}}')
  p.onChange.mockClear()
  fireEvent.click(screen.getByRole('button', { name: '友だち情報' }))
  fireEvent.click(await screen.findByRole('button', { name: 'ペット名' }))
  expect(p.onChange).toHaveBeenCalledExactlyOnceWith('本文{{field.pet_name}}')
  expect(screen.queryByRole('button', { name: 'ペット名' })).toBeNull()
})

it('入力欄のカーソル位置に差し込み、指定しない既存の処理を変えない', async () => {
  const p = props(), target = createRef<HTMLTextAreaElement>()
  render(<><textarea ref={target} defaultValue="本文" /><InsertToolbar {...p} targetRef={target} /></>)
  await loaded()
  target.current!.setSelectionRange(1, 1)
  fireEvent.click(screen.getByRole('button', { name: '名前' }))
  expect(p.onChange).toHaveBeenCalledExactlyOnceWith('本{{name}}文')
})

it('再描画前の拒否は候補を開く操作にも効き、読む候補の取得だけは維持する', async () => {
  let allowed = true
  const p = props()
  render(<InsertToolbar {...p} canChangeNow={() => allowed} />)
  await loaded()
  allowed = false
  fireEvent.click(screen.getByRole('button', { name: '友だち情報' }))
  expect(screen.queryByRole('button', { name: 'ペット名' })).toBeNull()
  expect(p.onChange).not.toHaveBeenCalled()
  expect(fixtures.fields).toHaveBeenCalledTimes(1)
})

it('許可中の差し込み後でも、遅れて動く焦点移動は権限変更後には実行しない', async () => {
  let allowed = true
  const frames: FrameRequestCallback[] = [], schedule = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length })
  try {
    const p = props(), target = createRef<HTMLTextAreaElement>()
    render(<><textarea ref={target} defaultValue="本文" /><InsertToolbar {...p} targetRef={target} canChangeNow={() => allowed} /></>)
    await loaded()
    const focus = vi.spyOn(target.current!, 'focus')
    fireEvent.click(screen.getByRole('button', { name: '名前' }))
    expect(p.onChange).toHaveBeenCalledTimes(1)
    expect(frames).toHaveLength(1)
    allowed = false
    frames[0](0)
    expect(focus).not.toHaveBeenCalled()
  } finally { schedule.mockRestore() }
})

it.each([{ label: '理由あり', gate: { lockedReason: reason }, locked: true }, { label: 'disabledだけ', gate: { disabled: true }, locked: false }, { label: 'callbackだけ', gate: { canChangeNow: () => false }, locked: false }])('開いた日付の窓を残し、欄と差し込みを拒む $label', async ({ gate, locked }) => {
  const p = props(), view = render(<InsertToolbar {...p} />)
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'その他' }))
  expect(screen.getByRole('button', { name: '目標日' })).toBeTruthy()
  act(() => fixtures.dateChange('2026-11-10'))
  view.rerender(<InsertToolbar {...p} {...gate} />)
  expect((screen.getByRole('button', { name: '目標日' }) as HTMLButtonElement).disabled).toBe(true)
  for (const name of ['入れる', '1日後', '30日後']) {
    const button = screen.getByRole('button', { name }) as HTMLButtonElement
    expect(button.disabled).toBe(!locked)
    expect(button.tabIndex).toBe(0)
    expect(button.getAttribute('aria-disabled')).toBe(locked ? 'true' : null)
    fireEvent.focus(button)
    if (locked) expect(screen.getByRole('tooltip').textContent).toBe(reason)
    else expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.click(button)
    fireEvent.blur(button)
  }
  expect(screen.getByRole('button', { name: '目標日' })).toBeTruthy()
  expect(p.onChange).not.toHaveBeenCalled()
})


it('目標日の変更も再描画前に拒否し、開いた窓と元の表示を残す', async () => {
  let allowed = true
  const p = props()
  render(<InsertToolbar {...p} canChangeNow={() => allowed} />)
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'その他' }))
  const field = screen.getByRole('button', { name: '目標日' }), before = field.textContent
  allowed = false
  act(() => fixtures.dateChange('2026-11-10'))
  expect(screen.getByRole('button', { name: '目標日' }).textContent).toBe(before)
  expect(p.onChange).not.toHaveBeenCalled()
})

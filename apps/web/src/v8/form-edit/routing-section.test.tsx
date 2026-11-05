// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import RoutingSection from './routing-section'

afterEach(cleanup)

// 決まり2: 行き先の決まりは帯にせず、題の横の「？」へ入れる。
it('行き先の決まりは帯に出さず題の「？」に入れる', async () => {
  render(<RoutingSection blocks={[
    { kind: 'input', type: 'booking' },
    { kind: 'input', type: 'radio', label: '来店の目的', choices: [{ label: '相談' }] },
  ] as never} refs={{}} routing={undefined} onChange={() => {}} />)
  await screen.findByText('答えで予約の行き先を分ける')
  expect(screen.queryByText(/行き先はこの表で決まる/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '答えで予約の行き先を分けるの説明' }))
  expect(await screen.findByText(/行き先はこの表で決まる/)).toBeTruthy()
})

it('未保存の表を試行し、実際の振り分け結果を表示する', async () => {
  const preview = vi.fn().mockResolvedValue({ matchedIndex: -1, fellBack: true, target: { menuId: 'm1' }, usable: true })
  const onChange = vi.fn()
  render(<RoutingSection blocks={[
    { id: 'q', kind: 'input', type: 'radio', name: 'subject', label: '内容', choices: [{ id: 'c', label: '相談' }] },
    { id: 'book', kind: 'input', type: 'booking' },
  ] as never} refs={{ bookingMenus: [{ id: 'm1', name: '相談', durationMinutes: 30 }] } as never}
  routing={{ enabled: true, rules: [], fallback: { menuId: 'm1' } }} onChange={onChange} onPreview={preview} />)
  fireEvent.click(screen.getByRole('button', { name: '試しに答える' }))
  fireEvent.click(screen.getByLabelText('試しの答え'))
  fireEvent.click((await screen.findByRole('option', { name: '相談' })).querySelector('button')!)
  expect(await screen.findByText(/行き先が使えないため/)).toBeTruthy()
  expect(preview).toHaveBeenCalledWith({ subject: '相談' })
  expect(onChange).not.toHaveBeenCalled()
})

it('閲覧のみは試行でき、編集操作は理由つきで拒む', async () => {
  const preview = vi.fn().mockResolvedValue({ matchedIndex: -1, fellBack: false, target: { menuId: 'm1' }, usable: true })
  const onChange = vi.fn()
  render(<RoutingSection blocks={[
    { id: 'q', kind: 'input', type: 'radio', name: 'subject', label: '内容', choices: [{ id: 'c', label: '相談' }] },
    { id: 'book', kind: 'input', type: 'booking' },
  ] as never} refs={{ bookingMenus: [{ id: 'm1', name: '相談', durationMinutes: 30 }] } as never}
  routing={{ enabled: true, rules: [], fallback: { menuId: 'm1' } }} readOnly onChange={onChange} onPreview={preview} />)
  const toggle = screen.getByRole('switch', { name: '答えで予約の行き先を分ける' })
  expect(toggle.getAttribute('aria-disabled')).toBe('true')
  expect((toggle as HTMLButtonElement).disabled).toBe(false)
  expect(toggle.hasAttribute('data-permission-locked')).toBe(true)
  fireEvent.focus(toggle)
  expect((await screen.findByRole('tooltip')).textContent).toContain('閲覧のみのため変更できません')
  fireEvent.click(toggle)
  fireEvent.click(screen.getByRole('button', { name: '試しに答える' }))
  fireEvent.click(screen.getByLabelText('試しの答え'))
  fireEvent.click((await screen.findByRole('option', { name: '相談' })).querySelector('button')!)
  expect(await screen.findByText(/どれにも当たらないとき.*行き先になります/)).toBeTruthy()
  expect(onChange).not.toHaveBeenCalled()
})

it('選択式の質問がなくても予約ブロックがあれば振り分けの設定を出す', async () => {
  render(<RoutingSection blocks={[{ id: 'book', kind: 'input', type: 'booking' }] as never} refs={{}} routing={undefined} onChange={() => {}} />)
  expect(await screen.findByRole('switch', { name: '答えで予約の行き先を分ける' })).toBeTruthy()
})

it('担当の組を全員と取り違えず、閲覧のみでは変更できない', () => {
  const onChange = vi.fn()
  render(<RoutingSection blocks={[{ id: 'book', kind: 'input', type: 'booking' }] as never}
    refs={{ bookingMenus: [{ id: 'm1', name: '相談', durationMinutes: 30 }], bookingRoutingGroups: [{ id: 'g1', name: '相談担当' }] } as never}
    routing={{ enabled: true, rules: [], fallback: { menuId: 'm1', staffGroupId: 'g1' } }} readOnly onChange={onChange} />)
  const control = screen.getByRole('button', { name: 'どれにも当たらないときの担当' })
  expect(control.parentElement?.textContent).toContain('相談担当')
  expect(control.getAttribute('aria-disabled')).toBe('true')
  expect((control as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(control)
  expect(onChange).not.toHaveBeenCalled()
})

it('担当の組を選ぶと組の ID を保存し、担当者指定と混ぜない', () => {
  const onChange = vi.fn()
  render(<RoutingSection blocks={[{ id: 'book', kind: 'input', type: 'booking' }] as never}
    refs={{ bookingMenus: [{ id: 'm1', name: '相談', durationMinutes: 30 }], bookingMenuStaff: { m1: [{ id: 's1', name: '担当者' }] }, bookingRoutingGroups: [{ id: 'g1', name: '相談担当' }] } as never}
    routing={{ enabled: true, rules: [], fallback: { menuId: 'm1', staffId: 's1' } }} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: 'どれにも当たらないときの担当' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('radio', { name: '組：相談担当' }))
  fireEvent.click(within(dialog).getByRole('button', { name: '選ぶ' }))
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fallback: { menuId: 'm1', staffId: undefined, staffGroupId: 'g1' } }))
})

it('試行中に別アカウントへ切り替わったら古い結果を出さない', async () => {
  let resolve!: (value: { matchedIndex: number; fellBack: boolean; target: { menuId: string }; usable: boolean }) => void
  const preview = vi.fn(() => new Promise<{ matchedIndex: number; fellBack: boolean; target: { menuId: string }; usable: boolean }>(done => { resolve = done }))
  const blocks = [{ id: 'q', kind: 'input', type: 'radio', name: 'subject', label: '内容', choices: [{ id: 'c', label: '相談' }] }, { id: 'book', kind: 'input', type: 'booking' }] as never
  const routing = { enabled: true, rules: [], fallback: { menuId: 'm1' } }
  const props = { blocks, refs: { bookingMenus: [{ id: 'm1', name: '相談', durationMinutes: 30 }] } as never, routing, onChange: vi.fn(), onPreview: preview }
  const view = render(<RoutingSection {...props} previewScope="account-a:form" />)
  fireEvent.click(screen.getByRole('button', { name: '試しに答える' }))
  fireEvent.click(screen.getByLabelText('試しの答え'))
  fireEvent.click((await screen.findByRole('option', { name: '相談' })).querySelector('button')!)
  view.rerender(<RoutingSection {...props} previewScope="account-b:form" />)
  view.rerender(<RoutingSection {...props} previewScope="account-a:form" />)
  await act(async () => resolve({ matchedIndex: -1, fellBack: false, target: { menuId: 'm1' }, usable: true }))
  expect(screen.queryByText(/行き先になります/)).toBeNull()
  expect(screen.getByLabelText('試しの答え').textContent).toContain('答えを選ぶ')
})

it('既存条件を残して別の質問を条件に加える', () => {
  const onChange = vi.fn()
  const routing = { enabled: true, rules: [{ conditions: [{ questionId: 'q1', op: 'is' as const, value: '相談' }], target: { menuId: 'm1' } }], fallback: { menuId: 'm1' } }
  render(<RoutingSection blocks={[
    { id: 'q1', kind: 'input', type: 'radio', name: 'purpose', label: '目的', choices: [{ label: '相談' }] },
    { id: 'q2', kind: 'input', type: 'radio', name: 'area', label: '地域', choices: [{ label: '東京' }] },
    { id: 'book', kind: 'input', type: 'booking' },
  ] as never} refs={{ bookingMenus: [{ id: 'm1', name: '相談', durationMinutes: 30 }], bookingRoutingGroups: [] } as never} routing={routing} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: '1 行目のそのほかの操作' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '条件を追加する' }))
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rules: [{ ...routing.rules[0], conditions: [...routing.rules[0].conditions, { questionId: 'q2', op: 'is', value: '東京' }] }] }))
})

it('2件目の条件を外しても、ほかの条件と行き先は残る', () => {
  const onChange = vi.fn()
  const conditions = [
    { questionId: 'q1', op: 'is' as const, value: '相談' },
    { questionId: 'q2', op: 'is' as const, value: '東京' },
    { questionId: 'q3', op: 'is' as const, value: '午前' },
  ]
  render(<RoutingSection blocks={[
    { id: 'q1', kind: 'input', type: 'radio', name: 'purpose', label: '目的', choices: [{ label: '相談' }] },
    { id: 'q2', kind: 'input', type: 'radio', name: 'area', label: '地域', choices: [{ label: '東京' }] },
    { id: 'q3', kind: 'input', type: 'radio', name: 'time', label: '時間', choices: [{ label: '午前' }] },
    { id: 'book', kind: 'input', type: 'booking' },
  ] as never} refs={{ bookingMenus: [{ id: 'm1', name: '相談', durationMinutes: 30 }], bookingRoutingGroups: [] } as never}
    routing={{ enabled: true, rules: [{ conditions, target: { menuId: 'm1' } }], fallback: { menuId: 'm1' } }} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: '条件 2 を外す' }))
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rules: [{ conditions: [conditions[0], conditions[2]], target: { menuId: 'm1' } }] }))
})

it('同じ答えで行を追加でき、1つ目の条件もほかの条件を残して変更できる', async () => {
  const onChange = vi.fn()
  const conditions = [{ questionId: 'q1', op: 'is' as const, value: '相談' }, { questionId: 'q2', op: 'is' as const, value: '東京' }]
  render(<RoutingSection blocks={[
    { id: 'q1', kind: 'input', type: 'radio', name: 'purpose', label: '目的', choices: [{ label: '相談' }, { label: '見積' }] },
    { id: 'q2', kind: 'input', type: 'radio', name: 'area', label: '地域', choices: [{ label: '東京' }] },
    { id: 'book', kind: 'input', type: 'booking' },
  ] as never} refs={{ bookingMenus: [{ id: 'm1', name: '相談', durationMinutes: 30 }], bookingRoutingGroups: [] } as never}
    routing={{ enabled: true, rules: [{ conditions, target: { menuId: 'm1' } }, { conditions: [{ questionId: 'q1', op: 'is', value: '見積' }], target: { menuId: 'm1' } }], fallback: { menuId: 'm1' } }} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: '行き先を追加' }))
  expect(onChange.mock.calls[0][0].rules[2].conditions).toEqual([{ questionId: 'q1', op: 'is', value: '相談' }])
  fireEvent.click(screen.getByLabelText('1 行目の答え'))
  fireEvent.click((await screen.findByRole('option', { name: '見積' })).querySelector('button')!)
  expect(onChange.mock.calls[1][0].rules[0].conditions).toEqual([{ questionId: 'q1', op: 'is', value: '見積' }, conditions[1]])
})

it('複数の答えを対象にする保存済み条件を編集できる', () => {
  const onChange = vi.fn()
  render(<RoutingSection blocks={[
    { id: 'q1', kind: 'input', type: 'checkbox', name: 'purpose', label: '目的', choices: [{ label: '相談' }, { label: '見積' }] },
    { id: 'book', kind: 'input', type: 'booking' },
  ] as never} refs={{ bookingMenus: [{ id: 'm1', name: '相談', durationMinutes: 30 }], bookingRoutingGroups: [] } as never}
    routing={{ enabled: true, rules: [{ conditions: [{ questionId: 'q1', op: 'in', value: ['相談'] }], target: { menuId: 'm1' } }], fallback: { menuId: 'm1' } }} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: '1 行目の答え' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '見積' }))
  fireEvent.click(within(dialog).getByRole('button', { name: '選ぶ（2件）' }))
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rules: [{ conditions: [{ questionId: 'q1', op: 'in', value: ['相談', '見積'] }], target: { menuId: 'm1' } }] }))
})

it('質問を変える前に行の消去を確認し、取り消すと残す', () => {
  const onChange = vi.fn()
  render(<RoutingSection blocks={[
    { id: 'q1', kind: 'input', type: 'radio', name: 'purpose', label: '目的', choices: [{ label: '相談' }] },
    { id: 'q2', kind: 'input', type: 'radio', name: 'area', label: '地域', choices: [{ label: '東京' }] },
    { id: 'book', kind: 'input', type: 'booking' },
  ] as never} refs={{ bookingMenus: [{ id: 'm1', name: '相談', durationMinutes: 30 }], bookingRoutingGroups: [] } as never}
    routing={{ enabled: true, rules: [{ conditions: [{ questionId: 'q1', op: 'is', value: '相談' }], target: { menuId: 'm1' } }], fallback: { menuId: 'm1' } }} onChange={onChange} />)
  const choose = () => {
    fireEvent.click(screen.getByRole('button', { name: '分ける質問' }))
    const picker = screen.getByRole('dialog')
    fireEvent.click(within(picker).getByRole('radio', { name: '地域（1 つ選ぶ）' }))
    fireEvent.click(within(picker).getByRole('button', { name: '選ぶ' }))
  }
  choose()
  let confirmation = screen.getByRole('dialog', { name: '分ける質問を変えますか？' })
  expect(within(confirmation).getByText(/行き先の条件がすべて消えます/)).toBeTruthy()
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.click(within(confirmation).getByRole('button', { name: 'キャンセル' }))
  expect(onChange).not.toHaveBeenCalled()
  choose()
  confirmation = screen.getByRole('dialog', { name: '分ける質問を変えますか？' })
  fireEvent.click(within(confirmation).getByRole('button', { name: '質問を変える' }))
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rules: [] }))
})


it('新規フォームは担当を保存後に選べる理由を表示し、操作できない', async () => {
 const onChange = vi.fn()
 render(<RoutingSection blocks={[{ id: 'book', kind: 'input', type: 'booking' }] as never}
   refs={{ bookingRoutingLockedReason: '保存してから選べます' }} routing={{ enabled: true, rules: [], fallback: { menuId: 'm1' } }} onChange={onChange} />)
 const control = screen.getByRole('button', { name: 'どれにも当たらないときの担当' })
 expect(control.hasAttribute('data-permission-locked')).toBe(true)
 fireEvent.focus(control)
 expect((await screen.findByRole('tooltip')).textContent).toContain('保存してから選べます')
 fireEvent.click(control)
 expect(onChange).not.toHaveBeenCalled()
})

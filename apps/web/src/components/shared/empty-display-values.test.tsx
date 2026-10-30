// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Zap } from 'lucide-react'
import type { FriendField, ReservationBoardEntry } from '@line-crm/shared'
import CustomerInfoPanel from './customer-info-panel'
import EmptyValue from './empty-value'
import { ReservationDining } from './reservation-board'
import { SourcePickerSelection } from './source-picker-dialog'
import { summarizeByFolder } from './hq-account-picker'
import TapActionField from './tap-action-field'

vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
afterEach(cleanup)
const cases = ['', ' \t\n　', null, '登録済み', ' 登録済み '] as const

test.each(cases)('顧客の基本欄は空文字・空白・nullを未設定にし、実値を保つ: %j', value => {
 const fields = [{ id: 'name', fixedKey: 'name', name: '名前', type: 'text', value }] as FriendField[]
 const { container } = render(<CustomerInfoPanel friendId="f" fields={fields} state="ready" canEdit={false} sections={[]} />)
 const cell = container.querySelector('dt')!.nextElementSibling!
 expect(cell.textContent).toBe(value?.trim() ? value : '未設定')
})

test.each(cases)('共通空値表示は指定された未設定を使い、実値を保つ: %j', value => {
 const { container } = render(<EmptyValue kind="unconfigured">{value}</EmptyValue>)
 expect(container.textContent).toBe(value?.trim() ? value : '未設定')
})

test.each(cases)('予約の飲食詳細は空値を既存の欠値表示にし、実値を保つ: %j', value => {
 const entry = { currentAllergy: value, dining: { allergy: value, anniversary: value, seatPreference: value } } as ReservationBoardEntry
 const { container } = render(<ReservationDining entry={entry} />)
 const shown = value?.trim() ? value : '—'
 expect([...container.querySelectorAll('dd')].slice(0, 4).map(e => e.textContent)).toEqual([shown, shown, shown, shown])
})

test.each(cases)('選んだ候補のフォルダ名は空値を欠値表示にし、実値を保つ: %j', value => {
 const { container } = render(<SourcePickerSelection item={{ id: 'i', name: '候補', category: 'message', categoryLabel: 'テキスト', folderId: 'f', updatedLabel: '更新済み' }} folders={[{ id: 'f', name: value as string }]} onChange={() => {}} />)
 const shown = value?.trim() ? value : '—'
 expect(container.textContent).toContain(shown)
})

test.each(cases)('選択先の要約は空のフォルダ名でも件数と実値を保つ: %j', value => {
 expect(summarizeByFolder([{ id: 'a', name: '本店', folderId: 'f' }], [{ id: 'f', name: value as string }])).toBe(`${value?.trim() ? value : '—'} 1`)
})

test.each(['', ' \t　', '動きを実行する', ' 動きを実行する '])('閲覧時の操作種類の空白だけを欠値表示にする: %j', label => {
 const { container } = render(<TapActionField name="画像" value={{ kind: 'action', refId: '' }} onChange={vi.fn()} readOnly extraKinds={[{ value: 'action', label, icon: Zap }]} />)
 expect(container.querySelector('[aria-label="画像を押したら：' + label + '"]')?.textContent).toBe(label.trim() ? label : '—')
})

test('共通空値表示は0とReact要素を空値へ変えない', () => {
 const { container, rerender } = render(<EmptyValue kind="unconfigured">{0}</EmptyValue>)
 expect(container.textContent).toBe('0')
 rerender(<EmptyValue kind="unconfigured"><strong>状態の札</strong></EmptyValue>)
 expect(container.querySelector('strong')?.textContent).toBe('状態の札')
})

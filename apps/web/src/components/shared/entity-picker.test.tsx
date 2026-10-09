// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EntityMultiPickerDialog, EntityPickerField, type EntityPickerItem } from './entity-picker'

afterEach(cleanup)

const folders = [{ id: 'f1', name: 'アンケート', color: '#3b82f6' }, { id: 'f2', name: '予約の前', color: '#22c55e' }]
const items: EntityPickerItem[] = [
  { id: 'a', name: '来店アンケート', folderId: 'f1', meta: '10/02 更新' },
  { id: 'b', name: '初回カウンセリング', folderId: 'f2', meta: '09/28 更新' },
  { id: 'c', name: '施術後アンケート', folderId: 'f1', meta: '08/30 更新' },
  { id: 'd', name: '分類なし', folderId: null },
]

function Single({ initial = '', readOnly = false, onChange = vi.fn() }: { initial?: string; readOnly?: boolean; onChange?: (id: string) => void }) {
  const [value, setValue] = useState(initial)
  return <EntityPickerField label="回答フォーム" noun="回答フォーム" items={items} folders={folders} value={value} readOnly={readOnly}
    createHref="/form-submissions/edit" createLabel="回答フォームを作る" preview={(item) => <p>{item ? `見本：${item.name}` : '見本なし'}</p>}
    onChange={(id) => { onChange(id); setValue(id) }} />
}

describe('作ってあるものを選ぶ欄と窓（dJZ7Q）', () => {
  it('欄は空なら［選ぶ］、選ぶと名前とフォルダ＋［変える］。窓の中で押しただけでは変わらない', async () => {
    const onChange = vi.fn()
    render(<Single onChange={onChange} />)
    expect(screen.getByText('（回答フォームを選んでください）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '回答フォーム：選ぶ' }))
    const dialog = await screen.findByRole('dialog', { name: '回答フォームを選ぶ' })
    // フォルダの列で絞る
    fireEvent.click(within(within(dialog).getByRole('navigation', { name: 'フォルダ' })).getByRole('button', { name: /アンケート/ }))
    expect(within(dialog).queryByRole('radio', { name: '初回カウンセリング' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('radio', { name: '来店アンケート' }))
    expect(within(dialog).getByText('見本：来店アンケート')).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
    // 窓の中に「新しく作る」は無く、作る画面へは文字リンク
    expect(within(dialog).queryByRole('button', { name: /新しく作る/ })).toBeNull()
    expect(within(dialog).getByRole('link', { name: /作る画面へ：回答フォームを作る/ }).getAttribute('href')).toBe('/form-submissions/edit')
    fireEvent.click(within(dialog).getByRole('button', { name: '選ぶ' }))
    expect(onChange).toHaveBeenCalledWith('a')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('来店アンケート')).toBeTruthy()
    expect(screen.getByText('フォルダ：アンケート')).toBeTruthy()
    expect(screen.getByRole('button', { name: '回答フォーム：変える' })).toBeTruthy()
  })

  it('キャンセルでは値を変えない。探す欄で名前を絞る', async () => {
    const onChange = vi.fn()
    render(<Single initial="b" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '回答フォーム：変える' }))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByRole('radio', { name: '初回カウンセリング' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: '施術' } })
    expect(within(dialog).getAllByRole('radio').map((row) => row.getAttribute('aria-label'))).toEqual(['施術後アンケート'])
    fireEvent.click(within(dialog).getByRole('radio', { name: '施術後アンケート' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('初回カウンセリング')).toBeTruthy()
  })

  it('閲覧のみでも窓は開いて見られるが［選ぶ］は出さない', async () => {
    render(<Single initial="a" readOnly />)
    fireEvent.click(screen.getByRole('button', { name: '回答フォーム：見る' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: '選ぶ' })).toBeNull()
    expect(within(dialog).getAllByRole('button', { name: '閉じる' })).toHaveLength(2)
  })

  it('消された候補を指していたら、見つからないと出して選び直させる', () => {
    render(<Single initial="gone" />)
    expect(screen.getByText('見つかりません')).toBeTruthy()
  })
})

describe('まとめて選ぶ窓', () => {
  it('フォルダの横のチェックでフォルダごと選び、一部だけなら「－」。選んだものだけ見て、確定で返す', async () => {
    const onConfirm = vi.fn()
    render(<EntityMultiPickerDialog title="配るアカウントを選ぶ" unit="アカウント" items={items} folders={folders} initialIds={['b']} onConfirm={onConfirm} onCancel={() => {}} />)
    const dialog = await screen.findByRole('dialog', { name: '配るアカウントを選ぶ' })
    const folderCheck = within(dialog).getByRole('checkbox', { name: 'アンケートをまとめて選ぶ' }) as HTMLInputElement
    fireEvent.click(folderCheck)
    expect((within(dialog).getByRole('checkbox', { name: '来店アンケート' }) as HTMLInputElement).checked).toBe(true)
    expect((within(dialog).getByRole('checkbox', { name: '施術後アンケート' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '施術後アンケート' }))
    expect((within(dialog).getByRole('checkbox', { name: 'アンケートをまとめて選ぶ' }) as HTMLInputElement).indeterminate).toBe(true)
    expect(within(dialog).getByText(/2 アカウントを選んでいます/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '選んだものだけ見る' }))
    expect(within(dialog).getAllByRole('checkbox').filter((box) => !box.getAttribute('aria-label')?.includes('まとめて')).map((box) => box.getAttribute('aria-label'))).toEqual(['来店アンケート', '初回カウンセリング'])
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'この 2 アカウントにする' }))
    expect(onConfirm).toHaveBeenCalledWith(['b', 'a'])
  })

  it('欄から開いた窓をキャンセルしても値は変わらず、確定すると件数と名前が出る', async () => {
    function Host() {
      const [value, setValue] = useState<string[]>([])
      return <EntityPickerField multiple label="タグ" noun="タグ" items={items} folders={folders} value={value} onChange={setValue} />
    }
    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: 'タグ：選ぶ' }))
    let dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '分類なし' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    expect(screen.getByText('（タグを選んでください）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'タグ：選ぶ' }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '分類なし' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '来店アンケート' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'この 2件にする' }))
    expect(screen.getByText('2件')).toBeTruthy()
    expect(screen.getByText('来店アンケート・分類なし')).toBeTruthy()
  })
})

describe('配るアカウントの欄の補足', () => {
  it('フォルダごとの数で「渋谷エリア 2・テスト 1」の形にし、フォルダを読めないときは名前を並べる', async () => {
    const { summarizeByFolder } = await import('./hq-account-picker')
    const f = [{ id: 's', name: '渋谷エリア' }, { id: 't', name: 'テスト' }]
    expect(summarizeByFolder([{ id: '1', name: '本店', folderId: 's' }, { id: '2', name: '渋谷店', folderId: 's' }, { id: '3', name: 'TEST', folderId: 't' }], f)).toBe('渋谷エリア 2・テスト 1')
    expect(summarizeByFolder([{ id: '1', name: '本店' }, { id: '2', name: '渋谷店' }], f)).toBe('本店・渋谷店')
  })
})

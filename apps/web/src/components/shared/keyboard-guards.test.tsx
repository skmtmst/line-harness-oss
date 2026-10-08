// @vitest-environment happy-dom
/*
 * V8 移行で崩れる原因⑨：共通の操作部品のキー操作の穴。
 *
 * - 日本語の変換中の Enter（確定）で保存・選択・作成しない（isComposing / keyCode 229）
 * - 詳細パネルは、ほかの部品が処理したキー（defaultPrevented）・別の面（メニュー・候補・別の窓）
 *   からのキーで行を動かさない／閉じない。保存中（busy）の Esc で閉じない。
 *
 * 実ブラウザの composition イベントでの確認は scripts の Playwright で別に見る。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const folderCreate = vi.hoisted(() => vi.fn(async () => ({ success: true, data: { id: 'f1' } })))
vi.mock('@/lib/api', () => ({ api: { folders: { create: folderCreate, update: vi.fn() } } }))
import DetailPanel from './detail-panel'
import InlineEdit from './inline-edit'
import Combobox from './combobox'
import MultiSelect from './multi-select'
import FolderAddDialog from './folder-add-dialog'
import { isImeComposing } from './ime'

afterEach(() => cleanup())

/** 変換中の Enter。isComposing を持たないブラウザ向けに keyCode 229 の形も試す。 */
const composingEnter = [
  { key: 'Enter', isComposing: true },
  { key: 'Enter', keyCode: 229 },
] as const

describe('日本語の変換中の判定', () => {
  it('isComposing・keyCode 229・React の nativeEvent のどれでも変換中とみなす', () => {
    expect(isImeComposing({ isComposing: true })).toBe(true)
    expect(isImeComposing({ keyCode: 229 })).toBe(true)
    expect(isImeComposing({ nativeEvent: { isComposing: true } })).toBe(true)
    expect(isImeComposing({ keyCode: 13 })).toBe(false)
  })
})

describe('その場で直す（InlineEdit）', () => {
  it.each(composingEnter)('変換中の Enter では保存しない（%o）', async (init) => {
    const onSave = vi.fn(async () => {})
    render(<InlineEdit label="名前" value="山田" onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: '名前を変更する' }))
    const input = screen.getByRole('textbox', { name: '名前' })
    fireEvent.change(input, { target: { value: 'やまだ' } })
    fireEvent.keyDown(input, init)
    expect(onSave).not.toHaveBeenCalled()
    // 確定の後の Enter では保存する
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(onSave).toHaveBeenCalledWith('やまだ')
  })

  it('変換中の Esc では編集をやめない（変換をやめるだけ）', () => {
    render(<InlineEdit label="名前" value="山田" onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '名前を変更する' }))
    const input = screen.getByRole('textbox', { name: '名前' })
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
    expect(screen.getByRole('textbox', { name: '名前' })).toBeTruthy()
  })
})

describe('選ぶ箱（Combobox）', () => {
  it('変換中の Enter で候補を選ばない', () => {
    const onChange = vi.fn()
    render(
      <Combobox
        aria-label="担当"
        value=""
        onChange={onChange}
        options={[{ value: 'a', label: 'あおき' }, { value: 'b', label: 'いのうえ' }]}
      />,
    )
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalled()
  })
})

describe('いくつも選ぶ箱（MultiSelect）', () => {
  it('変換中の Enter で候補を足さない', () => {
    const onChange = vi.fn()
    render(<MultiSelect aria-label="タグ" values={[]} onChange={onChange} options={[{ value: 'a', label: 'あき' }]} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['a'])
  })
})

describe('フォルダを足す窓', () => {
  it('変換の確定の Enter で書きかけの名前のフォルダを作らない', async () => {
    render(<FolderAddDialog kind="tag" onClose={() => {}} onAdded={() => {}} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'あき' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(folderCreate).not.toHaveBeenCalled()
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(folderCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'あき' }))
  })
})

describe('詳細パネルのキー（DetailPanel）', () => {
  function renderPanel(props?: Partial<React.ComponentProps<typeof DetailPanel>>) {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    const onClose = vi.fn()
    const utils = render(
      <DetailPanel open title="配信A" onClose={onClose} onPrev={onPrev} onNext={onNext} hasPrev hasNext {...props}>
        <div role="menu" aria-label="中のメニュー"><button type="button" role="menuitem">項目</button></div>
        <div role="tablist" aria-label="タブ"><button type="button" role="tab">タブ1</button></div>
      </DetailPanel>,
    )
    return { ...utils, onPrev, onNext, onClose }
  }

  it('ふつうの ↓ は次の行・Esc は閉じる（今までどおり）', () => {
    const { onNext, onClose } = renderPanel()
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(onNext).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ほかの部品が処理した ↓（defaultPrevented）では行を動かさない', () => {
    const { onNext } = renderPanel()
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    event.preventDefault()
    document.dispatchEvent(event)
    expect(onNext).not.toHaveBeenCalled()
  })

  it('メニュー・タブの並びの中の ↓ では行を動かさない', () => {
    const { onNext } = renderPanel()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: '項目' }), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('tab', { name: 'タブ1' }), { key: 'ArrowDown' })
    expect(onNext).not.toHaveBeenCalled()
  })

  it('開いているメニュー（器）があるときの Esc ではパネルを閉じない', () => {
    const { onClose } = renderPanel()
    const portal = document.createElement('div')
    portal.setAttribute('data-menu-portal', '')
    document.body.appendChild(portal)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    portal.remove()
  })

  it('保存中（busy）の Esc では閉じない', () => {
    const { onClose } = renderPanel({ busy: true })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('別の窓の中のキーでは行を動かさず、閉じない', () => {
    const { onNext, onClose } = renderPanel()
    const other = document.createElement('div')
    other.setAttribute('role', 'dialog')
    const button = document.createElement('button')
    other.appendChild(button)
    document.body.appendChild(other)
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    fireEvent.keyDown(button, { key: 'Escape' })
    expect(onNext).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    other.remove()
  })
})

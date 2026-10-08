// @vitest-environment happy-dom
/*
 * ★V8 フォルダを選ぶ欄（dLffh「作れる」・iBuZH「名前を入れる」。オーナー 2026-10-08）。
 * 作って選ばれる・失敗で名前が残る・変換中の Enter で作らない・権限なしで出ない、を見張る。
 */
import { act, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FolderSelect, { FolderCreateError, folderCreateResult, type FolderSelectCreate, type FolderSelectFolder } from './folder-select'
import { ApiError } from '@/lib/api'

const FOLDERS: FolderSelectFolder[] = [
  { value: 'f-1', label: 'お問い合わせ', color: '#3b82f6' },
  { value: 'f-2', label: '予約', color: '#16a34a' },
]

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  document.documentElement.dataset.theme = 'v8'
})
afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.theme
  vi.unstubAllGlobals()
})

function Host({ onCreate, onChange }: { onCreate?: FolderSelectCreate; onChange?: (value: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <FolderSelect
      aria-label="所属フォルダ"
      folders={FOLDERS}
      value={value}
      onChange={(next) => { setValue(next); onChange?.(next) }}
      onCreate={onCreate}
    />
  )
}

async function openMenu(props: { onCreate?: FolderSelectCreate; onChange?: (value: string) => void }) {
  await act(async () => { render(<Host {...props} />) })
  const button = screen.getByRole('button', { name: '所属フォルダ' })
  await act(async () => { fireEvent.click(button) })
  return button
}

const createRow = () => screen.queryByRole('button', { name: '新しいフォルダを作る' })

async function startCreate() {
  await act(async () => { fireEvent.click(createRow()!) })
  return screen.getByRole('textbox', { name: '新しいフォルダの名前' }) as HTMLInputElement
}

describe('開いた中身（dLffh）', () => {
  it('各行の前にフォルダの色の点、一番下に区切りと「＋ 新しいフォルダを作る」', async () => {
    await openMenu({ onCreate: vi.fn() })
    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['未分類', 'お問い合わせ', '予約'])
    const dots = options.map((option) => option.querySelector('[data-folder-select-dot]') as HTMLElement | null)
    expect(dots.every(Boolean)).toBe(true)
    expect(dots[1]!.style.backgroundColor).toBeTruthy()
    expect(createRow()).toBeTruthy()
    // 絵どおり、上の小さな見出しは「フォルダ」。閉じたボタンには頭を付けない。
    expect(document.querySelector('[data-select-menu]')!.textContent?.startsWith('フォルダ')).toBe(true)
    expect(screen.getByRole('button', { name: '所属フォルダ' }).textContent).toBe('未分類')
  })

  it('作る受け口が無い（閲覧のみ・権限なし）ときは「＋ 新しいフォルダを作る」を出さない', async () => {
    await openMenu({})
    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(createRow()).toBeNull()
  })

  it('キーボードで一番下の「＋」まで動いて Enter で名前を入れる板に替わる', async () => {
    const button = await openMenu({ onCreate: vi.fn() })
    for (let i = 0; i < 3; i += 1) await act(async () => { fireEvent.keyDown(button, { key: 'ArrowDown' }) })
    expect(createRow()!.getAttribute('data-active')).toBe('true')
    await act(async () => { fireEvent.keyDown(button, { key: 'Enter' }) })
    expect(screen.getByRole('textbox', { name: '新しいフォルダの名前' })).toBeTruthy()
  })
})

describe('名前を入れる（iBuZH）', () => {
  it('押すと同じ板が「新しいフォルダ」に替わり、名前の欄に焦点・横の色ボタンを押すと6色', async () => {
    await openMenu({ onCreate: vi.fn() })
    const input = await startCreate()
    expect(document.activeElement).toBe(input)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'フォルダの色：青' })) })
    expect(screen.getAllByRole('radio')).toHaveLength(6)
    expect(screen.getByRole('button', { name: '作って選ぶ' })).toBeTruthy()
  })

  it('作ると受け口に名前と色を渡し、一覧に足してそのフォルダを選んだ状態で閉じる', async () => {
    const onCreate = vi.fn<FolderSelectCreate>().mockResolvedValue({ value: 'f-new', label: '新規', color: '#ef4444' })
    const onChange = vi.fn()
    const button = await openMenu({ onCreate, onChange })
    const input = await startCreate()
    await act(async () => { fireEvent.change(input, { target: { value: ' 新規 ' } }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'フォルダの色：青' })) })
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: '赤' })) })
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'フォルダの色：赤' }).getAttribute('aria-expanded')).toBe('false')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '作って選ぶ' })) })
    expect(onCreate).toHaveBeenCalledWith('新規', '#ef4444')
    expect(onChange).toHaveBeenCalledWith('f-new')
    expect(screen.queryByRole('group', { name: '新しいフォルダ' })).toBeNull()
    expect(button.textContent).toContain('新規')
    await act(async () => { fireEvent.click(button) })
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toContain('新規')
  })

  it('作っている間は押せない（2回押しても1回だけ作る）', async () => {
    let resolve: (folder: FolderSelectFolder) => void = () => {}
    const onCreate = vi.fn<FolderSelectCreate>().mockImplementation(() => new Promise((done) => { resolve = done }))
    await openMenu({ onCreate })
    const input = await startCreate()
    await act(async () => { fireEvent.change(input, { target: { value: '新規' } }) })
    const primary = screen.getByRole('button', { name: '作って選ぶ' })
    await act(async () => { fireEvent.click(primary) })
    expect((screen.getByRole('button', { name: '作っています…' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'やめる' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(onCreate).toHaveBeenCalledTimes(1)
    await act(async () => { resolve({ value: 'f-new', label: '新規' }) })
  })

  it('失敗したら板の中に理由と［もう一度試す］、入れた名前は残る', async () => {
    const onCreate = vi.fn<FolderSelectCreate>()
      .mockRejectedValueOnce(new ApiError(409, '同じ名前のフォルダがあります'))
      .mockResolvedValueOnce({ value: 'f-new', label: '新規' })
    const onChange = vi.fn()
    await openMenu({ onCreate, onChange })
    const input = await startCreate()
    await act(async () => { fireEvent.change(input, { target: { value: '新規' } }) })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(screen.getByRole('alert').textContent).toBe('同じ名前のフォルダがあります')
    expect((screen.getByRole('textbox', { name: '新しいフォルダの名前' }) as HTMLInputElement).value).toBe('新規')
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'もう一度試す' })) })
    expect(onCreate).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenCalledWith('f-new')
  })

  it('日本語の変換中の Enter では作らない', async () => {
    const onCreate = vi.fn<FolderSelectCreate>()
    await openMenu({ onCreate })
    const input = await startCreate()
    await act(async () => { fireEvent.change(input, { target: { value: 'しんき' } }) })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 }) })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter', isComposing: true }) })
    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: '新しいフォルダの名前' })).toBeTruthy()
  })

  it('色の小窓は矢印キーで選べ、Esc は小窓だけを閉じて色ボタンへ戻る', async () => {
    await openMenu({ onCreate: vi.fn() })
    const input = await startCreate()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'フォルダの色：青' })) })
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '青' }))
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' }) })
    expect(screen.getByRole('radio', { name: '緑' }).getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '緑' }))
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }) })
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByRole('textbox', { name: '新しいフォルダの名前' })).toBe(input)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'フォルダの色：緑' }))
  })

  it('名前が空なら作れない', async () => {
    const onCreate = vi.fn<FolderSelectCreate>()
    await openMenu({ onCreate })
    const input = await startCreate()
    expect((screen.getByRole('button', { name: '作って選ぶ' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('Esc・［やめる］で一覧へ戻る（閉じない）', async () => {
    await openMenu({ onCreate: vi.fn() })
    await startCreate()
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(screen.getByRole('listbox')).toBeTruthy()
    await startCreate()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'やめる' })) })
    expect(screen.getByRole('listbox')).toBeTruthy()
  })

  it('名前の欄の Esc は一覧へ戻るだけで、後ろの聞き手（窓を閉じるなど）へ渡さない', async () => {
    const behind = vi.fn()
    document.addEventListener('keydown', behind)
    try {
      await openMenu({ onCreate: vi.fn() })
      const input = await startCreate()
      await act(async () => { fireEvent.keyDown(input, { key: 'Escape' }) })
      expect(screen.getByRole('listbox')).toBeTruthy()
      expect(behind).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', behind)
    }
  })

  it('変換をやめる Esc では一覧へ戻らない', async () => {
    await openMenu({ onCreate: vi.fn() })
    await startCreate()
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape', keyCode: 229 }) })
    expect(screen.getByRole('textbox', { name: '新しいフォルダの名前' })).toBeTruthy()
  })

  it('色を受け取らない受け口（colors={false}）は見本を出さず null を渡す', async () => {
    const onCreate = vi.fn<FolderSelectCreate>().mockResolvedValue({ value: 'h-1', label: '本部' })
    await act(async () => {
      render(<FolderSelect aria-label="フォルダ" folders={[]} value="" onChange={vi.fn()} onCreate={onCreate} colors={false} />)
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'フォルダ' })) })
    const input = await startCreate()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    await act(async () => { fireEvent.change(input, { target: { value: '本部' } }) })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(onCreate).toHaveBeenCalledWith('本部', null)
  })
})

describe('folderCreateResult', () => {
  it('失敗の答えは理由の Error、成功はフォルダに直す', () => {
    expect(() => folderCreateResult({ success: false, error: '同じ名前があります' }, () => ({ value: '', label: '' }))).toThrow(FolderCreateError)
    try { folderCreateResult({ success: false, error: '同じ名前があります' }, () => ({ value: '', label: '' })) } catch (caught) { expect((caught as FolderCreateError).reason).toBe('同じ名前があります') }
    // 英語・内部の文は理由に出さない（板は「作れませんでした」の案内にする）。
    expect(new FolderCreateError('Internal server error').reason).toBe('')
    expect(folderCreateResult({ success: true, data: { id: 'x', name: 'A' } }, (folder) => ({ value: folder.id, label: folder.name }))).toEqual({ value: 'x', label: 'A' })
  })
})

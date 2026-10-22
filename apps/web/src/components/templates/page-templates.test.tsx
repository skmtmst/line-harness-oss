// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreatePage, DetailColumns, ListPage, SettingsPage } from '.'
import { useState } from 'react'
import { PageFrame } from './page-frame'

afterEach(cleanup)
describe('V8 の型へ渡す操作', () => {
  it('作成型は下帯があると画面高さ、無いと内容高さ、明示指定を優先する', () => {
    const { container, rerender } = render(<CreatePage title="作成" footerActions={<button>次へ</button>}>短い内容</CreatePage>)
    const frame = () => container.querySelector('[data-page-template="create"]')!
    expect(frame().getAttribute('data-frame-height')).toBe('viewport')
    rerender(<CreatePage title="作成" footerActions={null}>短い内容</CreatePage>)
    expect(frame().getAttribute('data-frame-height')).toBe('content')
    rerender(<CreatePage title="作成" heightMode="content" footerActions={<button>保存</button>}>明示した内容高さ</CreatePage>)
    expect(frame().getAttribute('data-frame-height')).toBe('content')
  })
  it('一覧型は画面の任意指定によらず標準の一覧寸法と検査を持つ', () => {
    const { container, rerender } = render(<ListPage title="一覧">表</ListPage>)
    expect(container.querySelector('[data-page-template="list"]')?.getAttribute('data-list-skeleton')).toBe('templates')
    rerender(<PageFrame kind="create">入力</PageFrame>)
    expect(container.querySelector('[data-page-template="create"]')?.hasAttribute('data-list-skeleton')).toBe(false)
  })
  it('一覧の高さは本文で決まり、単独の板と明示した画面高さを保つ', () => {
    const { container, rerender } = render(<ListPage title="一覧">少ない行</ListPage>)
    const frame = () => container.querySelector('[data-page-template]')!
    expect(frame().getAttribute('data-frame-height')).toBe('content')
    rerender(<ListPage title="一覧">{Array.from({ length: 20 }, (_, i) => <p key={i}>行{i}</p>)}</ListPage>)
    expect(frame().getAttribute('data-frame-height')).toBe('content')
    expect(container.querySelectorAll('p')).toHaveLength(20)
    rerender(<ListPage title="一覧" heightMode="viewport">本文</ListPage>)
    expect(frame().getAttribute('data-frame-height')).toBe('viewport')
    rerender(<ListPage title="一覧" standalone>小窓</ListPage>)
    expect(frame().hasAttribute('data-frame-height')).toBe(false)
    rerender(<PageFrame kind="create">入力</PageFrame>)
    expect(frame().hasAttribute('data-frame-height')).toBe(false)
  })
  it('畳んだ詳細欄を開閉でき、検索欄の入力を保持する', () => {
    function Example() {
      const [expanded, setExpanded] = useState(false)
      return <DetailColumns asideLabel="回答の詳細・絞り込み" aside={<input aria-label="回答を探す" />} expanded={expanded} onExpandedChange={setExpanded}>回答表</DetailColumns>
    }
    render(<Example />)
    const toggle = screen.getByRole('button', { name: '回答の詳細・絞り込み' })
    const aside = screen.getByRole('complementary', { name: '回答の詳細・絞り込み' })
    expect(toggle.getAttribute('aria-controls')).toBe(aside.id)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(aside.hasAttribute('data-expanded')).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: '回答を探す' }), { target: { value: 'ココ' } })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect((screen.getByRole('textbox', { name: '回答を探す' }) as HTMLInputElement).value).toBe('ココ')
  })
  it('補助欄の無い詳細は開く操作と空き列を持たず、本文を残す', () => {
    const { container, rerender } = render(<DetailColumns asideLabel="生成設定" aside={null} expanded={false} onExpandedChange={vi.fn()}><button>画像を開く</button></DetailColumns>)
    const columns = () => container.firstElementChild!
    expect(columns().hasAttribute('data-has-aside')).toBe(false)
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.queryByRole('button', { name: '生成設定' })).toBeNull()
    expect(screen.getByRole('button', { name: '画像を開く' })).toBeTruthy()
    rerender(<DetailColumns asideLabel="生成設定" aside={<input aria-label="生成文" />} expanded={false} onExpandedChange={vi.fn()}>画像一覧</DetailColumns>)
    expect(columns().hasAttribute('data-has-aside')).toBe(true)
    expect(screen.getByRole('button', { name: '生成設定' })).toBeTruthy()
  })
  it('本文幅の保存口を選んだ画面だけ本文内に置き、既存の配置は保つ', () => {
    const { container, rerender } = render(<SettingsPage title="設定" navigation="目次" saveActions={<button>保存</button>}>内容</SettingsPage>)
    const content = () => container.querySelector('[data-template-region="content"]')!
    expect(content().querySelector('[data-template-region="footer"]')).toBeNull()
    rerender(<SettingsPage title="設定" navigation="目次" savePlacement="content" saveActions={<button>保存</button>}>内容</SettingsPage>)
    expect(content().querySelector('[data-template-region="footer"]')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '保存' })).toHaveLength(1)
  })

  it('畳んだ設定の見本を開閉しても入力と保存を保持する', () => {
    const save = vi.fn()
    render(<SettingsPage title="プールを作る" navigation="目次" previewLayout="cards" preview={<p>受け入れ先の見本</p>} saveActions={<button onClick={save}>保存</button>}><input aria-label="プール名" defaultValue="渋谷" /></SettingsPage>)
    fireEvent.change(screen.getByRole('textbox', { name: 'プール名' }), { target: { value: '中目黒' } })
    fireEvent.click(screen.getByRole('button', { name: 'プレビューを開く' }))
    expect(screen.getByRole('dialog', { name: 'プレビュー' }).textContent).toContain('受け入れ先の見本')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((screen.getByRole('textbox', { name: 'プール名' }) as HTMLInputElement).value).toBe('中目黒')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(save).toHaveBeenCalledOnce()
  })

  it('設定の変更があるときだけ保存口を出し、渡された処理を実行する', () => {
    const save = vi.fn()
    const { rerender } = render(<SettingsPage title="設定" navigation={<a href="#delivery">配信</a>}><section id="delivery">配信設定</section></SettingsPage>)
    expect(screen.queryByRole('button', { name: '変更を保存' })).toBeNull()
    rerender(<SettingsPage title="設定" navigation={<a href="#delivery">配信</a>} saveActions={<button onClick={save}>変更を保存</button>}><section id="delivery">配信設定</section></SettingsPage>)
    fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
    expect(save).toHaveBeenCalledOnce()
    expect(screen.getByRole('navigation', { name: 'この設定の目次' })).toBeTruthy()
  })
  it('型の説明は初めに開き、閉じてもボタンにフォーカスを保つ', () => {
    render(<ListPage title="タグ" explanation="友だちに付ける目印です。">一覧</ListPage>)
    const help = screen.getByRole('button', { name: 'この画面の説明' })
    help.focus(); fireEvent.click(help)
    expect(screen.getByText('友だちに付ける目印です。')).toBeTruthy()
    expect(document.activeElement).toBe(help)
    expect(help.getAttribute('aria-expanded')).toBe('false')
  })
  it('作る型の手順は題と説明の下の行だけ（同行の置き方は無い）', () => {
    render(<CreatePage title="作成" help="説明" steps={<ol><li>手順</li></ol>} footerActions={<button>保存</button>}>入力</CreatePage>)
    const heading = screen.getByText('作成').closest('header')!
    expect(heading.hasAttribute('data-steps-placement')).toBe(false)
    expect(heading.querySelector('[data-template-region="steps"]')?.textContent).toBe('手順')
  })
  it('作成の危ない操作と保存を分け、押せない保存は実行しない', () => {
    const save = vi.fn()
    render(<CreatePage title="作成" destructive={<button>削除</button>} footerActions={<button disabled onClick={save}>保存</button>}>入力</CreatePage>)
    const saveButton = screen.getByRole('button', { name: '保存' })
    fireEvent.click(saveButton)
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '削除' }).parentElement).not.toBe(saveButton.parentElement)
  })
})

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreatePage, ListPage, SettingsPage } from './index'

afterEach(cleanup)
describe('V8 の型へ渡す操作', () => {
  it('本文幅の保存口を選んだ画面だけ本文内に置き、既存の配置は保つ', () => {
    const { container, rerender } = render(<SettingsPage title="設定" navigation="目次" saveActions={<button>保存</button>}>内容</SettingsPage>)
    const content = () => container.querySelector('[data-template-region="content"]')!
    expect(content().querySelector('[data-template-region="footer"]')).toBeNull()
    rerender(<SettingsPage title="設定" navigation="目次" savePlacement="content" saveActions={<button>保存</button>}>内容</SettingsPage>)
    expect(content().querySelector('[data-template-region="footer"]')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '保存' })).toHaveLength(1)
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
  it('型の説明をキーボード操作で開き、閉じたら元の？へ戻る', () => {
    render(<ListPage title="タグ" help="友だちに付ける目印です。">一覧</ListPage>)
    const help = screen.getByRole('button', { name: 'タグの説明' })
    help.focus(); fireEvent.click(help)
    expect(screen.getByText('友だちに付ける目印です。')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(help)
    expect(help.getAttribute('aria-expanded')).toBe('false')
  })
  it('作る型の手順は題と説明の下の行だけ（同行の置き方は無い）', () => {
    render(<CreatePage title="作成" description="説明" steps={<ol><li>手順</li></ol>} footerActions={<button>保存</button>}>入力</CreatePage>)
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

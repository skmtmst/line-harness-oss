// @vitest-environment happy-dom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CONFIRM_WIDTH, dialogWidth, drawerWidth } from './destination-policy'
import ConfirmDialog from './confirm-dialog'
import ActionMenu from './action-menu'
import TextLink from './text-link'
import Button from './button'
import { Tr, Td } from './table'
import InlineSettings from './inline-settings'
import { insertDuplicateAfter } from './use-duplicate-feedback'
import EditorSurface from './editor-surface'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('B-177: 行き先の共通の約束', () => {
  it('確認窓は480、長い本文を指定した窓は560', () => {
    render(<ConfirmDialog open title="削除しますか？" description="確認します" onCancel={() => {}} />)
    expect(screen.getByRole('dialog').style.getPropertyValue('--dialog-design-width')).toBe(`${CONFIRM_WIDTH}px`)
    cleanup()
    render(<ConfirmDialog open designWidth={560} title="送りますか？" description="対象を確認します" onCancel={() => {}}>長い本文</ConfirmDialog>)
    expect(screen.getByRole('dialog').style.getPropertyValue('--dialog-design-width')).toBe('560px')
  })
  it('旧い指定幅も4段へそろう。引き出しは480・540', () => {
    expect([400, 520, 600, 620, 640, 680, 800, 840, 860, 1060].map(dialogWidth)).toEqual([480, 480, 560, 560, 560, 720, 720, 720, 960, 960])
    expect([480, 540, 560, 620, 660].map(drawerWidth)).toEqual([480, 540, 540, 540, 540])
  })
  it('↗ のメニューは本物の新しいタブのリンク。内部の操作はボタン', () => {
    const select = vi.fn(), close = vi.fn()
    render(<ActionMenu open inline onClose={close} items={[{ id: 'outside', label: '公式サイト', external: true, href: 'https://example.com' }, { id: 'inside', label: '中身を見る', onSelect: select }]} />)
    const link = screen.getByRole('menuitem', { name: '公式サイト' })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer')
    fireEvent.click(screen.getByRole('menuitem', { name: '中身を見る' }))
    expect(select).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
  it('無効な外部リンクは開かず、理由を読める', () => {
    render(<ActionMenu open inline onClose={() => {}} items={[{ id: 'outside', label: '外へ', href: 'https://example.com', external: true, disabled: true, disabledReason: '権限がありません' }]} />)
    expect(screen.getByRole('menuitem').tagName).toBe('BUTTON')
    expect(screen.getByText('権限がありません')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
  it('文字リンクとボタンも新しいタブとnoreferrerを部品が付ける', () => {
    render(<><TextLink external href="https://example.com">手引き</TextLink><Button external href="https://example.com">公式サイト</Button></>)
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noreferrer')
    }
  })
  it('行の余白とEnterで同じ中身を開く。子のチェックやボタンでは開かない', () => {
    const open = vi.fn(), child = vi.fn()
    render(<table><tbody><Tr interactive onOpen={open}><Td>名前</Td><Td><input type="checkbox" aria-label="選ぶ" /><button onClick={child}>複製する</button></Td></Tr></tbody></table>)
    const row = screen.getByRole('row')
    fireEvent.click(screen.getByText('名前'))
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button'))
    expect(open).toHaveBeenCalledTimes(2)
    expect(child).toHaveBeenCalledOnce()
  })
  it('行のCtrl/⌘押しは新しいタブ、名前のリンクは通常のリンクのまま', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<table><tbody><Tr interactive href="/templates/detail?id=1"><Td><a href="/templates/detail?id=1">名前</a></Td><Td>下書き</Td></Tr></tbody></table>)
    fireEvent.click(screen.getByText('下書き'), { metaKey: true })
    expect(open).toHaveBeenCalledWith('/templates/detail?id=1', '_blank', 'noreferrer')
    expect(screen.getByRole('link').getAttribute('href')).toBe('/templates/detail?id=1')
  })
  it('押す中身がない行はhoverとTabの止まりを持たない', () => {
    render(<table><tbody><Tr interactive><Td>記録だけ</Td></Tr></tbody></table>)
    expect(screen.getByRole('row').className).not.toContain('rowInteractive')
    expect(screen.getByRole('row').hasAttribute('tabindex')).toBe(false)
  })
  it('項目の設定はその場の領域。窓や入力のコピーを増やさない', () => {
    const close = vi.fn()
    render(<InlineSettings open title="選択肢1の設定" onClose={close}><input aria-label="押したら" defaultValue="hello" /></InlineSettings>)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('region', { name: '選択肢1の設定' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '設定を閉じる' }))
    expect(close).toHaveBeenCalledOnce()
  })
  it('編集をページにすると窓を描かず、作る型と保存の帯を使う', () => {
    render(<EditorSurface surface="page" open title="編集する" onCancel={() => {}} onConfirm={() => {}}><input aria-label="名前" /></EditorSurface>)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { name: '編集する' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存する' }).closest('[data-template-region="footer"]')).toBeTruthy()
  })
  it('コピーは元の行のすぐ下、重複を作らず元の一覧を壊さない', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(insertDuplicateAfter(rows, 'b', { id: 'copy' }).map(row => row.id)).toEqual(['a', 'b', 'copy', 'c'])
    expect(rows.map(row => row.id)).toEqual(['a', 'b', 'c'])
    expect(insertDuplicateAfter([...rows, { id: 'copy' }], 'b', { id: 'copy' }).filter(row => row.id === 'copy')).toHaveLength(1)
  })
})

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import DashboardEditor, {
  defaultDashboardPreferences,
  moveDashboardItem,
} from './dashboard-editor'

/*
 * R116: ダッシュボードの並べ替えに、ドラッグ不要のクリック操作が無い。
 * 上下ボタンで1つずつ動かせるようにし、結果は日本語で読み上げる。
 */
afterEach(cleanup)

const items = [
  { id: 'today-inbox', visible: true },
  { id: 'today-photo-review', visible: true },
  { id: 'today-bookings', visible: true },
] as Parameters<typeof moveDashboardItem>[0]

describe('R116 上下ボタンでの並べ替え', () => {
  it('1つ上・1つ下へ動かし、端では何もしない', () => {
    expect(moveDashboardItem(items, 'today-photo-review', 'up').map((i) => i.id)).toEqual([
      'today-photo-review', 'today-inbox', 'today-bookings',
    ])
    expect(moveDashboardItem(items, 'today-photo-review', 'down').map((i) => i.id)).toEqual([
      'today-inbox', 'today-bookings', 'today-photo-review',
    ])
    expect(moveDashboardItem(items, 'today-inbox', 'up')).toBe(items)
    expect(moveDashboardItem(items, 'today-bookings', 'down')).toBe(items)
    expect(moveDashboardItem(items, 'unknown' as never, 'up')).toBe(items)
  })

  it('ボタンを押すだけで順番が変わり、結果を日本語で読み上げる', () => {
    const onApply = vi.fn()
    render(
      <DashboardEditor
        open
        preferences={defaultDashboardPreferences()}
        onCancel={() => undefined}
        onApply={onApply}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '写真審査を1つ上へ移動' }))
    const announced = screen.getAllByRole('status').map((node) => node.textContent)
    expect(announced).toContain('写真審査を1番目へ移動しました')
    fireEvent.click(screen.getByRole('button', { name: 'ダッシュボードに反映' }))
    const today = (onApply.mock.calls[0][0].today as { id: string }[]).map((i) => i.id)
    expect(today.slice(0, 2)).toEqual(['today-photo-review', 'today-inbox'])
  })

  it('いちばん上では上へ、いちばん下では下へ押せない', () => {
    render(
      <DashboardEditor
        open
        preferences={defaultDashboardPreferences()}
        onCancel={() => undefined}
        onApply={() => undefined}
      />,
    )
    expect(screen.getByRole('button', { name: '対応が必要な受信を1つ上へ移動' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '出荷予定件数を1つ下へ移動' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '写真審査を1つ上へ移動' }).hasAttribute('disabled')).toBe(false)
  })

  it('操作の案内はドラッグだけでなくボタンにも触れる', () => {
    render(
      <DashboardEditor
        open
        preferences={defaultDashboardPreferences()}
        onCancel={() => undefined}
        onApply={() => undefined}
      />,
    )
    expect(screen.getByText('上下ボタン・ドラッグ・キーボードで順番を変更。スイッチで表示を切り替えます。')).toBeTruthy()
  })
})

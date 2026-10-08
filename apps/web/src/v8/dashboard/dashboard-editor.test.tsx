// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { defaultDashboardPreferences, V8_DASHBOARD_DEFAULT_VISIBILITY } from '@/components/dashboard/dashboard-preference-defaults'
import DashboardEditorV8 from './dashboard-editor'

/*
 * ★V8 ダッシュボード編集（mcOqK）の動き。v7 の編集（components/dashboard/dashboard-editor）と
 * 同じ保存の形・並べ替え・4枠の計算を守り、絵で足した状態（4枠の注意・確認の窓・下の帯）を見る。
 */
afterEach(cleanup)

const prefs = () => defaultDashboardPreferences(V8_DASHBOARD_DEFAULT_VISIBILITY)

function renderEditor(props: Partial<Parameters<typeof DashboardEditorV8>[0]> = {}) {
  const onApply = vi.fn()
  const onCancel = vi.fn()
  const onReset = vi.fn()
  render(<DashboardEditorV8 open preferences={prefs()} onApply={onApply} onCancel={onCancel} onReset={onReset} {...props} />)
  return { onApply, onCancel, onReset }
}

describe('V8 ダッシュボード編集', () => {
  it('上下ボタンで順番が変わり、反映で同じ形の配置を渡す。結果は日本語で読み上げる', () => {
    const { onApply } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: '写真審査を1つ上へ移動' }))
    expect(screen.getAllByRole('status').map((n) => n.textContent)).toContain('写真審査を1番目へ移動しました')
    fireEvent.click(screen.getByRole('button', { name: 'ダッシュボードに反映' }))
    const next = onApply.mock.calls[0][0]
    expect(Object.keys(next).sort()).toEqual(['main', 'right', 'today'])
    expect(next.today.slice(0, 2).map((i: { id: string }) => i.id)).toEqual(['today-photo-review', 'today-inbox'])
  })

  it('端では上へ・下へを押せない', () => {
    renderEditor()
    expect(screen.getByRole('button', { name: '対応が必要な受信を1つ上へ移動' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '出荷予定件数を1つ下へ移動' }).hasAttribute('disabled')).toBe(true)
  })

  it('スイッチで表示を切り替え、反映した配置に出る', () => {
    const { onApply } = renderEditor()
    fireEvent.click(screen.getByRole('switch', { name: 'シナリオ配信状況を表示' }))
    fireEvent.click(screen.getByRole('button', { name: 'ダッシュボードに反映' }))
    const main = onApply.mock.calls[0][0].main as { id: string; visible: boolean }[]
    expect(main.find((i) => i.id === 'scenario-status')?.visible).toBe(true)
  })

  it('4枠の注意はふだん出さない。5つ目を ON にした瞬間だけ、OFF にしたカードの名前で出す', () => {
    const base = prefs()
    // 「今日やること」の候補は今は4つ（候補が4つ以下なら一度も出ない）。5つ目は試験のために足す。
    base.today = [{ id: 'shipment', visible: false }, ...base.today.map((item) => ({ ...item, visible: true }))]
    renderEditor({ preferences: base })
    expect(screen.queryByText('「今日やること」は4枠までです')).toBeNull()
    fireEvent.click(screen.getAllByRole('switch', { name: '出荷予定を表示' })[0])
    expect(screen.getByText('「今日やること」は4枠までです')).toBeTruthy()
    expect(screen.getByText(/いちばん下の「出荷予定件数」をOFFにしました/)).toBeTruthy()
  })

  it('5つ目を ON にしなければ、ON/OFF を何度切り替えても注意は出ない', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('switch', { name: '写真審査を表示' }))
    fireEvent.click(screen.getByRole('switch', { name: '写真審査を表示' }))
    expect(screen.queryByText('「今日やること」は4枠までです')).toBeNull()
  })

  it('初期状態に戻すは確認の窓を挟む。キャンセルなら何もしない', () => {
    const { onReset } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: '初期状態に戻す' }))
    expect(screen.getByText('現在の配置を削除して初期状態へ戻します。この操作はすぐに保存され、あとからキャンセルしても元には戻りません。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onReset).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '初期状態に戻す' }))
    fireEvent.click(screen.getByRole('button', { name: /削除して初期状態へ戻す/ }))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('保存の失敗は下の帯に理由と「もう一度保存する」。押すと同じ配置で保存し直す', () => {
    const { onApply } = renderEditor({ saveError: '配置を保存できませんでした。通信を確かめてください。' })
    expect(screen.getByText('配置を保存できませんでした。通信を確かめてください。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'もう一度保存する' }))
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it('409 は「最新の配置を読み込む」。読み込んだ配置が編集の起点になる', async () => {
    const latest = prefs()
    latest.today = [...latest.today].reverse()
    const onReloadPreferences = vi.fn(async () => latest)
    const { onApply } = renderEditor({ saveError: 'ほかの人が配置を変えました。', saveConflict: true, onReloadPreferences })
    expect(screen.queryByRole('button', { name: 'もう一度保存する' })).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '最新の配置を読み込む' }))
    })
    expect(onReloadPreferences).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'ダッシュボードに反映' }))
    expect(onApply.mock.calls[0][0].today.map((i: { id: string }) => i.id)).toEqual(latest.today.map((i) => i.id))
  })

  it('保存中は閉じる・反映を押せず、反映は「保存中…」になる', () => {
    renderEditor({ saving: true })
    for (const close of screen.getAllByRole('button', { name: '閉じる' })) expect(close.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /保存中/ }).hasAttribute('disabled')).toBe(true)
  })

  it('閉じるで配置を渡さずに閉じる', () => {
    const { onApply, onCancel } = renderEditor()
    const closes = screen.getAllByRole('button', { name: '閉じる' })
    fireEvent.click(closes[closes.length - 1])
    expect(onCancel).toHaveBeenCalled()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('プレビューは配置の順にカードの名前を出し、PC とスマホを切り替える', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'プレビュー' }))
    expect(screen.getByText('実際のダッシュボードと同じ順番で表示します。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'スマホ' }))
    expect(screen.getByText(/「集計を見る」で開きます/)).toBeTruthy()
  })
})

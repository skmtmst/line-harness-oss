// @vitest-environment happy-dom
/*
 * 運用状態 › セキュリティの見張り。守るのは：
 *  - 一覧の読み込みに失敗しても「異常なし」の 0 件にしない。
 *  - 一覧が空でも「安全」とは書かず、記録の範囲を言う。
 *  - 見張りの最後の完了が15分以上前（または未取得）なら故障の注意を出す。
 *  - 閲覧のみにはボタンを置かない。
 *  - ［確かめた］［解決した］は古い版を渡し、解決は確認の小窓をはさむ。409 は読み直して知らせる。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SecurityMonitorPanel } from './security-monitor'

const fixture = vi.hoisted(() => ({ list: vi.fn(), acknowledge: vi.fn(), resolve: vi.fn() }))

vi.mock('@/lib/api/helpers/security-monitor', () => ({ securityMonitorApi: fixture }))

const minutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString()
const alert = (patch: Record<string, unknown> = {}) => ({
  id: 'a-1', ruleKey: 'login_failures', summary: 'ログインの失敗が増えています', count: 23, threshold: 20, status: 'open', version: 3,
  firstDetectedAt: minutesAgo(30), lastDetectedAt: minutesAgo(5), reviewedAt: null, notification: 'sent', ...patch,
})
const reply = (items: unknown[], monitor: Record<string, unknown> = {}) => ({ success: true, data: {
  items, monitor: { status: 'running', lastStartedAt: minutesAgo(3), lastCompletedAt: minutesAgo(3), configurationValid: true, ...monitor },
  thresholds: {}, configurationValid: true, windowMinutes: 15, limit: 200, offset: 0, total: items.length,
} })

afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks() })

async function chooseAction(label: string) {
  fireEvent.click(await screen.findByRole('button', { name: /のその他操作/ }))
  fireEvent.click(await screen.findByRole('menuitem', { name: label }))
}

describe('セキュリティの見張り', () => {
  it('異常を並べ、確かめた・解決したのボタンを出す', async () => {
    fixture.list.mockResolvedValue(reply([alert()]))
    render(<SecurityMonitorPanel accountId="acc-1" canOperate />)
    expect(await screen.findByText('ログインの失敗が増えています')).toBeTruthy()
    expect(screen.getByText('見張りは動いています')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /のその他操作/ }))
    expect(screen.getByRole('menuitem', { name: '確かめた' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '解決した' })).toBeTruthy()
    expect(fixture.list).toHaveBeenCalledWith('acc-1', 0)
  })

  it('一覧が空でも「安全」とは書かず、記録の範囲を言う', async () => {
    fixture.list.mockResolvedValue(reply([]))
    render(<SecurityMonitorPanel accountId="acc-1" canOperate />)
    expect(await screen.findByText(/見張りの記録では、未対応の異常はありません/)).toBeTruthy()
    expect(screen.queryByText(/安全/)).toBeNull()
  })

  it('取得に失敗したら 0 件にせず、やり直しを出す', async () => {
    fixture.list.mockRejectedValue(new Error('x'))
    render(<SecurityMonitorPanel accountId="acc-1" canOperate />)
    expect(await screen.findByRole('button', { name: /もう一度|再読み込み|やり直/ })).toBeTruthy()
    expect(screen.queryByText(/未対応の異常はありません/)).toBeNull()
  })

  it('見張りの最後の完了が15分以上前なら故障の注意を出す', async () => {
    fixture.list.mockResolvedValue(reply([], { lastCompletedAt: minutesAgo(40), status: 'stale' }))
    render(<SecurityMonitorPanel accountId="acc-1" canOperate />)
    expect(await screen.findByText(/見張りの最後の完了が15分以上前/)).toBeTruthy()
    expect(screen.getByText('見張りが止まっているかもしれません')).toBeTruthy()
  })

  it('完了の記録が無いときも故障の注意（緑にしない）', async () => {
    fixture.list.mockResolvedValue(reply([], { lastCompletedAt: null, status: 'unknown' }))
    render(<SecurityMonitorPanel accountId="acc-1" canOperate />)
    expect(await screen.findByText(/見張りの最後の完了が15分以上前か、まだ確認できていません/)).toBeTruthy()
    expect(screen.getByText('まだ確認できていません')).toBeTruthy()
  })

  it('閲覧のみにはボタンを置かない', async () => {
    fixture.list.mockResolvedValue(reply([alert()]))
    render(<SecurityMonitorPanel accountId="acc-1" canOperate={false} />)
    expect(await screen.findByText('ログインの失敗が増えています')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '確かめた' })).toBeNull()
    expect(screen.queryByRole('button', { name: '解決した' })).toBeNull()
    expect(screen.queryByRole('button', { name: /のその他操作/ })).toBeNull()
  })

  it('アカウントが未選択なら口を呼ばない', () => {
    render(<SecurityMonitorPanel accountId={null} canOperate />)
    expect(screen.getByText('アカウントを選んでください')).toBeTruthy()
    expect(fixture.list).not.toHaveBeenCalled()
  })

  it('［確かめた］は一覧の版を渡して記録し、読み直す', async () => {
    fixture.list.mockResolvedValue(reply([alert()]))
    fixture.acknowledge.mockResolvedValue({ success: true, data: { id: 'a-1', status: 'acknowledged', version: 4 } })
    render(<SecurityMonitorPanel accountId="acc-1" canOperate />)
    await chooseAction('確かめた')
    expect(await screen.findByText('この異常を確かめたことにしますか？')).toBeTruthy()
    const confirms = screen.getAllByRole('button', { name: '確かめた' })
    fireEvent.click(confirms[confirms.length - 1])
    await waitFor(() => expect(fixture.acknowledge).toHaveBeenCalledWith('a-1', 3, 'acc-1'))
    await waitFor(() => expect(fixture.list.mock.calls.length).toBeGreaterThan(1))
  })

  it('古い版で断られたら（409）、読み直して知らせる', async () => {
    const { ApiError } = await import('@/lib/api')
    fixture.list.mockResolvedValue(reply([alert()]))
    fixture.resolve.mockRejectedValue(new ApiError(409, 'conflict'))
    render(<SecurityMonitorPanel accountId="acc-1" canOperate />)
    await chooseAction('解決した')
    const confirms = await screen.findAllByRole('button', { name: '解決した' })
    fireEvent.click(confirms[confirms.length - 1])
    expect(await screen.findByText(/ほかの人が先に更新しました/)).toBeTruthy()
    await waitFor(() => expect(fixture.list.mock.calls.length).toBeGreaterThan(1))
  })

  it('［解決した］は確認の小窓をはさみ、版を渡す', async () => {
    fixture.list.mockResolvedValue(reply([alert()]))
    fixture.resolve.mockResolvedValue({ success: true, data: { id: 'a-1', status: 'resolved', version: 4 } })
    render(<SecurityMonitorPanel accountId="acc-1" canOperate />)
    await chooseAction('解決した')
    expect(await screen.findByText('この異常を解決済みにしますか？')).toBeTruthy()
    const confirms = screen.getAllByRole('button', { name: '解決した' })
    fireEvent.click(confirms[confirms.length - 1])
    await waitFor(() => expect(fixture.resolve).toHaveBeenCalledWith('a-1', 3, 'acc-1'))
  })
})


describe('監視状態と応答の寿命', () => {
  it.each(['unknown', 'failed'])('%s を動作中と表示しない', async (status) => {
    fixture.list.mockResolvedValue(reply([], { status, lastCompletedAt: null }))
    render(<SecurityMonitorPanel accountId="acc-1" canOperate />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('見張りは動いています')).toBeNull()
    expect(screen.getByText(/最後に完了した時刻（日本時間）：未取得/)).toBeTruthy()
  })

  it('定期取得に失敗したら古い緑の状態を残さない', async () => {
    fixture.list.mockResolvedValueOnce(reply([])).mockRejectedValue(new Error('監視の取得に失敗しました'))
    vi.useFakeTimers()
    await act(async () => { render(<SecurityMonitorPanel accountId="acc-1" canOperate />) })
    expect(screen.getByText('見張りは動いています')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60000) })
    expect(screen.queryByText('見張りは動いています')).toBeNull()
    expect(screen.queryByText(/未対応の異常はありません/)).toBeNull()
    expect(screen.getByRole('button', { name: /もう一度|再読み込み|やり直/ })).toBeTruthy()
  })

  it('取得中の定期・表示復帰は重複せず、店の切替と解除後の応答は捨てる', async () => {
    let finishOld!: (value: ReturnType<typeof reply>) => void
    fixture.list.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve }))
      .mockResolvedValueOnce(reply([alert({ summary: '新しい店の異常' })]))
    vi.useFakeTimers()
    const view = render(<SecurityMonitorPanel accountId="acc-1" canOperate />)
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60000) })
    fireEvent(document, new Event('visibilitychange'))
    expect(fixture.list).toHaveBeenCalledTimes(1)
    await act(async () => { view.rerender(<SecurityMonitorPanel accountId="acc-2" canOperate />) })
    expect(screen.getByText('新しい店の異常')).toBeTruthy()
    await act(async () => { finishOld(reply([alert({ summary: '古い店の異常' })])) })
    expect(screen.queryByText('古い店の異常')).toBeNull()
    view.unmount()
    vi.useFakeTimers()
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60000) })
    fireEvent(document, new Event('visibilitychange'))
    expect(fixture.list).toHaveBeenCalledTimes(2)
  })

  it('再取得が返らなくても、完了記録が15分以上前になったら緑を外す', async () => {
    vi.useFakeTimers()
    fixture.list.mockResolvedValueOnce(reply([])).mockReturnValue(new Promise(() => {}))
    await act(async () => { render(<SecurityMonitorPanel accountId="acc-1" canOperate />) })
    expect(screen.getByText('見張りは動いています')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60000) })
    expect(screen.queryByText('見張りは動いています')).toBeNull()
    expect(screen.getByText('見張りが止まっているかもしれません')).toBeTruthy()
    expect(fixture.list).toHaveBeenCalledTimes(2)
  })

  it('競合後の再確認では最新の版を送り、二重実行しない', async () => {
    const { ApiError } = await import('@/lib/api')
    fixture.list.mockResolvedValueOnce(reply([alert()])).mockResolvedValue(reply([alert({ version: 4 })]))
    let finish!: (value: unknown) => void
    fixture.resolve.mockRejectedValueOnce(new ApiError(409, 'conflict'))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    render(<SecurityMonitorPanel accountId="acc-1" canOperate />)
    await chooseAction('解決した')
    fireEvent.click(screen.getByRole('button', { name: '解決した' }))
    await screen.findByText(/ほかの人が先に更新しました/)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await chooseAction('解決した')
    const confirm = screen.getByRole('button', { name: '解決した' })
    fireEvent.click(confirm); fireEvent.click(confirm)
    expect(fixture.resolve.mock.calls).toEqual([['a-1', 3, 'acc-1'], ['a-1', 4, 'acc-1']])
    await act(async () => { finish({ success: true }) })
  })

  it('別の店へ切り替えたら前の店の確認窓を閉じる', async () => {
    fixture.list.mockResolvedValue(reply([alert()]))
    const view = render(<SecurityMonitorPanel accountId="acc-1" canOperate />)
    await chooseAction('確かめた')
    expect(screen.getByRole('dialog')).toBeTruthy()
    view.rerender(<SecurityMonitorPanel accountId="acc-2" canOperate />)
    await screen.findByText('ログインの失敗が増えています')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fixture.acknowledge).not.toHaveBeenCalled()
    expect(fixture.list).toHaveBeenLastCalledWith('acc-2', 0)
  })

  it('変更前に始まった定期取得より、更新後に取得した版を優先する', async () => {
    let oldPoll!: (value: ReturnType<typeof reply>) => void
    fixture.list.mockResolvedValueOnce(reply([alert()]))
      .mockReturnValueOnce(new Promise((resolve) => { oldPoll = resolve }))
      .mockResolvedValue(reply([alert({ version: 4, status: 'acknowledged' })]))
    fixture.acknowledge.mockResolvedValue({ success: true })
    fixture.resolve.mockResolvedValue({ success: true })
    render(<SecurityMonitorPanel accountId="acc-1" canOperate />)
    await screen.findByText('ログインの失敗が増えています')
    fireEvent(document, new Event('visibilitychange'))
    expect(fixture.list).toHaveBeenCalledTimes(2)
    await chooseAction('確かめた')
    fireEvent.click(screen.getByRole('button', { name: '確かめた' }))
    await waitFor(() => expect(fixture.list).toHaveBeenCalledTimes(3))
    await act(async () => { oldPoll(reply([alert()])) })
    await chooseAction('解決した')
    fireEvent.click(screen.getByRole('button', { name: '解決した' }))
    await waitFor(() => expect(fixture.resolve).toHaveBeenCalledWith('a-1', 4, 'acc-1'))
  })

  it('変更中に画面を閉じても、完了したあと旧画面の再取得を始めない', async () => {
    let finish!: (value: unknown) => void
    fixture.list.mockResolvedValue(reply([alert()]))
    fixture.acknowledge.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const view = render(<SecurityMonitorPanel accountId="acc-1" canOperate />)
    await chooseAction('確かめた')
    fireEvent.click(screen.getByRole('button', { name: '確かめた' }))
    view.unmount()
    await act(async () => { finish({ success: true }) })
    expect(fixture.list).toHaveBeenCalledTimes(1)
  })

  it('200件単位の次頁を読み、取得失敗後に再取得できる', async () => {
    fixture.list.mockResolvedValueOnce({ ...reply([alert()]), data: { ...reply([alert()]).data, total: 201 } })
      .mockRejectedValueOnce(new Error('次の頁を取得できませんでした'))
      .mockResolvedValueOnce({ ...reply([alert()]), data: { ...reply([alert()]).data, offset: 200, total: 201 } })
    render(<SecurityMonitorPanel accountId="acc-1" canOperate />)
    fireEvent.click(await screen.findByRole('button', { name: '次の200件' }))
    fireEvent.click(await screen.findByRole('button', { name: /もう一度|再読み込み|やり直/ }))
    await screen.findByText('201〜201件 / 201件')
    expect(fixture.list.mock.calls).toEqual([['acc-1', 0], ['acc-1', 200], ['acc-1', 200]])
  })
})

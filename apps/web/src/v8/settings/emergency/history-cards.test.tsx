// @vitest-environment happy-dom
/*
 * SPEC-7 更新履歴の画面：1回の更新＝1枚を描いたときの形。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import UpdateHistoryV8 from './history'

vi.mock('@/generated/release-log.json', () => ({ default: { releases: [
  { version: 'unreleased', released: null, entries: [{ kind: 'fixed', text: '配信の予定を変える' }] },
  { version: '0.26.0', released: '2026-10-25 18:00', entries: [{ kind: 'added', text: '予約の札を足した', at: '2026-10-25T09:30' }] },
  { version: '0.25.0', released: '2026-10-14 02:05', entries: [{ kind: 'fixed', text: '要約に無い古い本文' }] },
] } }))

const history = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ api: { operations: { history } } }))
vi.mock('@/lib/use-running-version', () => ({ useRunningVersion: () => ({ detail: { version: '0.26.0', released_at: '2026-10-25T09:00:00Z' }, statusText: '稼働版を確認' }) }))
vi.mock('@/generated/release-log-summary.json', () => ({ default: {
  releases: [
    { version: 'unreleased', released: null, entryCount: 4, entries: [] },
    { version: '0.26.0', released: '2026-10-25 18:00', entryCount: 5, entries: [
      { kind: 'changed', text: '一覧の並びを変えた', by: 'kenta', pr: 1, at: '2026-10-25T10:00' },
      { kind: 'added', text: '予約の札を足した', by: 'kenta', pr: 2, at: '2026-10-25T09:30' },
      { kind: 'fixed', text: '配信の宛先の誤りを直した', by: 'kenta', pr: 3, at: '2026-10-25T09:00' },
      { kind: 'fixed', text: '保存できない時の知らせを直した', by: 'kenta', pr: 4, at: '2026-10-25T08:00' },
      { kind: 'added', text: '前の日の行', by: 'kenta', pr: 5, at: '2026-10-24T08:00' },
    ] },
    { version: '0.25.0', released: '2026-10-14 02:05', entryCount: 5707, entries: [] },
  ],
  updates: [{ version: '0.25.0', source: 'archive' }],
  pending: { entryCount: 4, counts: { added: 2, changed: 1, fixed: 1 } },
} }))
afterEach(() => { cleanup(); history.mockReset() })

function cards() {
  return [...document.querySelectorAll<HTMLElement>('[data-update-card]')]
}

it('1回ごとに1枚：日付・種類の数・3行・［すべて見る］を出し、「最新」は今の版の1枚だけ', async () => {
  history.mockResolvedValue({ success: true, data: [] })
  render(<UpdateHistoryV8 />)
  await waitFor(() => expect(cards().length).toBe(4))
  expect(cards().map((card) => card.dataset.updateCard)).toEqual(['pending', 'day', 'day', 'archive'])

  const latest = document.querySelectorAll('[data-update-latest]')
  expect(latest).toHaveLength(1)
  expect(latest[0]).toBe(cards()[1])
  expect(within(cards()[1]).getByText('最新')).toBeTruthy()
  expect(screen.getAllByText('最新')).toHaveLength(1)

  const top = cards()[1]
  expect(top.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-25T10:00+09:00')
  expect(within(top).getByText('0.26.0')).toBeTruthy()
  expect(within(within(top).getByRole('list', { name: '種類ごとの数' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['追加 1', '変更 1', '修正 2'])
  expect(within(within(top).getByRole('list', { name: 'この回のおもな変更' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['配信の宛先の誤りを直した', '保存できない時の知らせを直した', '予約の札を足した'])
  expect(within(top).getByText('すべて見る（4 行）')).toBeTruthy()
  expect(within(within(top).getByRole('list', { name: 'この回のすべての変更' })).getAllByRole('listitem')).toHaveLength(4)

  // 前の日の1枚は1行だけ。作り物で埋めず、［すべて見る］も出さない。
  const older = cards()[2]
  expect(within(within(older).getByRole('list', { name: 'この回のおもな変更' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['前の日の行'])
  expect(within(older).queryByText(/すべて見る/)).toBeNull()

  expect(within(cards()[0]).getByText('これから入る変更')).toBeTruthy()
  expect(within(cards()[0]).queryByText('最新')).toBeNull()
  expect(within(cards()[3]).getByText('前の版のまとめ（5,707 行）')).toBeTruthy()
  // IND-U06本文：作る側の言葉ではなく利用者向けの説明を出す。
  expect(within(cards()[3]).getByText('この版の行は前の版のまとめに集めてあり、この画面には出していません。')).toBeTruthy()
  expect(within(cards()[3]).queryByText(/保管用の記録にまとめてあり/)).toBeNull()
})

it('配備の記録が読めない時も版の並びは出し、結果を「成功」と言わない', async () => {
  history.mockRejectedValue(new Error('network down'))
  render(<UpdateHistoryV8 />)
  await screen.findByText('更新の記録を読み込めませんでした')
  expect(screen.getByText('版の一覧は出しています。配備の結果は読み直すと出ます。')).toBeTruthy()
  expect(cards().length).toBe(4)
  expect(screen.queryByText('成功')).toBeNull()
})

it('検証への配備の1枚に結果と配備の仕方を出し、行はその配備の回に入る', async () => {
  history.mockResolvedValue({ success: true, data: [
    { historyKind: 'deployment', deployment: { deploymentId: 'dep-2', phase: 'succeeded', environment: 'staging', version: '0.26.0', pullRequest: null, actor: 'github-actions', occurredAt: '2026-10-25T00:45:00Z' } },
    { historyKind: 'deployment', deployment: { deploymentId: 'dep-1', phase: 'succeeded', environment: 'staging', version: '0.26.0', pullRequest: null, actor: 'kenta', occurredAt: '2026-10-24T09:00:00Z' } },
  ] })
  render(<UpdateHistoryV8 />)
  await waitFor(() => expect(document.querySelector('[data-update-card="deployment"]')).toBeTruthy())
  const deployed = cards().find((card) => card.querySelector('time')?.getAttribute('datetime') === '2026-10-25T09:45+09:00')!
  expect(within(deployed).getByText('成功')).toBeTruthy()
  expect(within(deployed).getByText('0.26.0・検証へ自動で配備')).toBeTruthy()
  expect(within(within(deployed).getByRole('list', { name: 'この回のおもな変更' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['配信の宛先の誤りを直した', '保存できない時の知らせを直した', '予約の札を足した'])
  // 配備より後の行は日の1枚、最初の配備より前の行も日の1枚。
  expect(cards().map((card) => card.dataset.updateCard)).toEqual(['pending', 'day', 'deployment', 'deployment', 'day', 'archive'])
})

it('画面に仕組みの名前（表・関数・ファイルの名前）を出さない', async () => {
  history.mockResolvedValue({ success: true, data: [] })
  const { container } = render(<UpdateHistoryV8 />)
  await waitFor(() => expect(cards().length).toBe(4))
  expect(container.textContent).not.toMatch(/release[-_]log|deployment|highlights|summary|unreleased|\.md\b|\.json\b/i)
})

it('本文を検索しても日付と版を保ち、消すと全体へ戻る', async () => {
  history.mockResolvedValue({ success: true, data: [] })
  render(<UpdateHistoryV8 />)
  await waitFor(() => expect(cards()).toHaveLength(4))
  fireEvent.change(screen.getByRole('searchbox', { name: '変更内容を探す' }), { target: { value: '予約' } })
  await waitFor(() => expect(cards()).toHaveLength(1))
  expect(within(cards()[0]).getByText('0.26.0')).toBeTruthy()
  expect(within(cards()[0]).getByText('予約の札を足した')).toBeTruthy()
  expect(screen.queryByText('配信の宛先の誤りを直した')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '検索語を消す' }))
  await waitFor(() => expect(cards()).toHaveLength(4))
})


it('保管用の版の本文も検索して表示し、予定とは区別する', async () => {
  history.mockResolvedValue({ success: true, data: [] })
  render(<UpdateHistoryV8 />)
  await waitFor(() => expect(cards()).toHaveLength(4))
  fireEvent.change(screen.getByRole('searchbox', { name: '変更内容を探す' }), { target: { value: '要約に無い古い本文' } })
  await screen.findByText('要約に無い古い本文')
  expect(cards()).toHaveLength(1)
  expect(cards()[0].dataset.updateCard).toBe('archive')
  expect(within(cards()[0]).getByText('0.25.0')).toBeTruthy()
  expect(cards()[0].querySelector('time')?.getAttribute('datetime')).toBe('2026-10-14T02:05+09:00')
  fireEvent.change(screen.getByRole('searchbox', { name: '変更内容を探す' }), { target: { value: '配信の予定' } })
  await screen.findByText('配信の予定を変える')
  expect(cards()).toHaveLength(1)
  expect(cards()[0].dataset.updateCard).toBe('pending')
})

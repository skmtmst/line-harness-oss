import { expect, it } from 'vitest'
import { buildUpdateCards, searchUpdateCards, type ReleaseSummary } from './history-updates'

it('これから入る変更の本文も検索し、公開済みとは別のカードを保つ', () => {
  const summary: ReleaseSummary = { releases: [
    { version: 'unreleased', released: null, entries: [{ kind: 'fixed', text: '予約の時間を直す予定' }] },
    { version: '1.0.0', released: '2026-10-25', entries: [{ kind: 'added', text: '予約の機能を追加した' }, { kind: 'fixed', text: '配信を直した' }] },
  ] }
  const cards = buildUpdateCards({ summary, deployments: [] })
  const found = searchUpdateCards(cards, '予約')
  expect(found.map((card) => card.source)).toEqual(['pending', 'day'])
  expect(found[0].entries.map((entry) => entry.text)).toEqual(['予約の時間を直す予定'])
  expect(found[1].entries.map((entry) => entry.text)).toEqual(['予約の機能を追加した'])
  expect(searchUpdateCards(cards, '存在しない文')).toEqual([])
  expect(searchUpdateCards(cards, '  ')).toBe(cards)
})


it('要約から省かれた公開済みと保管用の本文も、版と日付のまとまりで探す', () => {
  const summary: ReleaseSummary = {
    updates: [{ version: '0.9.0', source: 'archive', counts: { fixed: 1 } }],
    releases: [
      { version: '1.0.0', released: '2026-10-25', entries: [{ kind: 'fixed', text: '以前の予約の不具合', at: '2026-10-24 10:00' }] },
      { version: '0.9.0', released: '2026-09-01', entries: [{ kind: 'fixed', text: '古い予約の修正' }] },
    ],
  }
  const initial = buildUpdateCards({ summary, deployments: [] })
  expect(initial.find(card => card.source === 'archive')?.entries).toEqual([])
  const cards = buildUpdateCards({ summary, deployments: [], includeArchivedEntries: true })
  const found = searchUpdateCards(cards, '予約')
  expect(found.map(card => [card.version, card.source, card.at])).toEqual([
    ['1.0.0', 'day', '2026-10-24T10:00+09:00'],
    ['0.9.0', 'archive', '2026-09-01T00:00+09:00'],
  ])
  expect(found.flatMap(card => card.entries.map(entry => entry.text))).toEqual(['以前の予約の不具合', '古い予約の修正'])
})

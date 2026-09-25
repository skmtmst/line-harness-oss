// @vitest-environment happy-dom
/* #820: 版の履歴（汎用）。札・選ぶ・比べる・戻す。 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VersionHistory, { type HistoryVersion } from './version-history'

afterEach(() => cleanup())

const VERSIONS: HistoryVersion[] = [
  { versionNumber: 3, title: '第3版', status: 'in_use', statusNote: 'いま使っている', summary: '審査の決まりを追加', author: '佐藤', at: '9/10 11:02' },
  { versionNumber: 2, title: '第2版', status: 'past', summary: '最初の決まり' },
  { versionNumber: 1, title: '第1版', status: 'past' },
]

function renderHistory(selected: number | null = 3) {
  const onSelect = vi.fn()
  const onCompare = vi.fn()
  const onRevert = vi.fn()
  render(
    <VersionHistory
      versions={VERSIONS}
      selectedVersionNumber={selected}
      onSelect={onSelect}
      compareLabel="第2版と比べる"
      onCompare={onCompare}
      revertLabel="第2版に戻す"
      onRevert={onRevert}
    />,
  )
  return { onSelect, onCompare, onRevert }
}

describe('版の履歴', () => {
  it('札が3種出る（使用中・過去）', () => {
    renderHistory()
    expect(screen.getByText('使用中')).toBeTruthy()
    expect(screen.getAllByText('過去')).toHaveLength(2)
  })

  it('版を選ぶと onSelect に番号が渡る', () => {
    const { onSelect } = renderHistory()
    fireEvent.click(screen.getByText('第2版'))
    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('比べる・戻すを押せる', () => {
    const { onCompare, onRevert } = renderHistory()
    fireEvent.click(screen.getByText('第2版と比べる'))
    expect(onCompare).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('第2版に戻す'))
    expect(onRevert).toHaveBeenCalledTimes(1)
  })

  it('選んでいないと比べる・戻すは押せない', () => {
    renderHistory(null)
    expect((screen.getByText('第2版と比べる') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('第2版に戻す') as HTMLButtonElement).disabled).toBe(true)
  })

  it('空のときは無い旨だけ出す（件数・飾りを出さない）', () => {
    render(
      <VersionHistory
        versions={[]}
        selectedVersionNumber={null}
        onSelect={() => {}}
        compareLabel="比べる"
        onCompare={() => {}}
        revertLabel="戻す"
        onRevert={() => {}}
      />,
    )
    expect(screen.getByText('版はまだありません。')).toBeTruthy()
  })

  it('予約の札が出る', () => {
    render(
      <VersionHistory
        versions={[{ versionNumber: 4, title: '第4版', status: 'reserved', statusNote: '10/1から使う' }]}
        selectedVersionNumber={4}
        onSelect={() => {}}
        compareLabel="比べる"
        onCompare={() => {}}
        revertLabel="戻す"
        onRevert={() => {}}
      />,
    )
    expect(screen.getByText('予約')).toBeTruthy()
    expect(screen.getByText('10/1から使う')).toBeTruthy()
  })
})

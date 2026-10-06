// @vitest-environment happy-dom
/*
 * 保存がぶつかったとき（409）の共通の道（動きの点検 16 番）。
 * 帯（違いを比べる／最新を読み込んで続ける）・比べる窓・読み直しを見る。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SaveConflictBand,
  SaveConflictCompareDialog,
  saveConflictTitle,
  useSaveConflict,
  type SaveConflictDiffLine,
} from './save-conflict'

afterEach(() => cleanup())

type Doc = { name: string }

function Harness({ fetchLatest, reload }: { fetchLatest: () => Promise<Doc | null>; reload: () => Promise<void> }) {
  const [name, setName] = React.useState('わたしの名前')
  const conflict = useSaveConflict<Doc>({
    fetchLatest,
    reload: async () => {
      await reload()
      setName('最新の名前')
      conflict.clear()
    },
  })
  const lines: SaveConflictDiffLine[] | null = conflict.latest
    ? conflict.latest.name === name ? [] : [{ kind: 'change', text: `名前が違います（最新「${conflict.latest.name}」）` }]
    : null
  return (
    <div>
      <p>いまの名前：{name}</p>
      <button type="button" onClick={() => conflict.mark('')}>保存（409）</button>
      {conflict.conflict ? (
        <SaveConflictBand
          designNode="k32cn"
          title={saveConflictTitle(conflict.conflict.updatedAt, 'リマインダ', name)}
          compareBusy={conflict.compareBusy}
          onCompare={() => void conflict.compare()}
          onReload={() => void conflict.reloadLatest()}
        />
      ) : null}
      <SaveConflictCompareDialog
        open={conflict.compareOpen}
        busy={conflict.compareBusy}
        error={conflict.compareError}
        lines={lines}
        onReload={() => void conflict.reloadLatest()}
        onCancel={conflict.closeCompare}
      />
    </div>
  )
}

describe('保存がぶつかったときの帯と比べる窓', () => {
  it('409 で帯（role=alert・板の印）と2つの道を出す', () => {
    render(<Harness fetchLatest={vi.fn()} reload={vi.fn()} />)
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '保存（409）' }))
    const band = screen.getByRole('alert')
    expect(band.getAttribute('data-design-node')).toBe('k32cn')
    expect(within(band).getByText('ほかの人が先にリマインダ「わたしの名前」を保存しました')).toBeTruthy()
    expect(within(band).getByText(/このまま保存すると、相手の変更が消えます/)).toBeTruthy()
    expect(within(band).getByRole('button', { name: '違いを比べる' })).toBeTruthy()
    expect(within(band).getByRole('button', { name: '最新を読み込んで続ける' })).toBeTruthy()
  })

  it('「違いを比べる」は最新を取って窓に違いを出すだけで、画面は書き換えない', async () => {
    const fetchLatest = vi.fn(async () => ({ name: '相手の名前' }))
    const reload = vi.fn(async () => {})
    render(<Harness fetchLatest={fetchLatest} reload={reload} />)
    fireEvent.click(screen.getByRole('button', { name: '保存（409）' }))
    fireEvent.click(screen.getByRole('button', { name: '違いを比べる' }))
    const dialog = await screen.findByRole('dialog', { name: '最新の保存と比べる' })
    expect(fetchLatest).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByText(/名前が違います（最新「相手の名前」）/)).toBeTruthy()
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByText('いまの名前：わたしの名前')).toBeTruthy()
    // 閉じても帯は残る（まだ決めていない）
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '最新の保存と比べる' })).toBeNull())
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('最新が取れなければ窓に理由を出し、読み直さない', async () => {
    const reload = vi.fn(async () => {})
    render(<Harness fetchLatest={vi.fn(async () => null)} reload={reload} />)
    fireEvent.click(screen.getByRole('button', { name: '保存（409）' }))
    fireEvent.click(screen.getByRole('button', { name: '違いを比べる' }))
    const dialog = await screen.findByRole('dialog', { name: '最新の保存と比べる' })
    expect(within(dialog).getByText('最新の内容を取れませんでした。もう一度お試しください。')).toBeTruthy()
    expect(reload).not.toHaveBeenCalled()
  })

  it('窓の「最新を読み込んで続ける」で読み直し、窓と帯が消える', async () => {
    const reload = vi.fn(async () => {})
    render(<Harness fetchLatest={vi.fn(async () => ({ name: '相手の名前' }))} reload={reload} />)
    fireEvent.click(screen.getByRole('button', { name: '保存（409）' }))
    fireEvent.click(screen.getByRole('button', { name: '違いを比べる' }))
    const dialog = await screen.findByRole('dialog', { name: '最新の保存と比べる' })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '最新を読み込んで続ける' }))
    })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(screen.getByText('いまの名前：最新の名前')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '最新の保存と比べる' })).toBeNull())
  })

  it('帯の「最新を読み込んで続ける」は比べずにそのまま読み直す', async () => {
    const fetchLatest = vi.fn(async () => ({ name: '相手の名前' }))
    const reload = vi.fn(async () => {})
    render(<Harness fetchLatest={fetchLatest} reload={reload} />)
    fireEvent.click(screen.getByRole('button', { name: '保存（409）' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '最新を読み込んで続ける' }))
    })
    expect(fetchLatest).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('違いが無ければ「違いは見つかりませんでした」と言う', async () => {
    render(<Harness fetchLatest={vi.fn(async () => ({ name: 'わたしの名前' }))} reload={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '保存（409）' }))
    fireEvent.click(screen.getByRole('button', { name: '違いを比べる' }))
    const dialog = await screen.findByRole('dialog', { name: '最新の保存と比べる' })
    expect(within(dialog).getByText('違いは見つかりませんでした。そのまま読み込めます。')).toBeTruthy()
  })
})

describe('帯の題', () => {
  it('時刻が読めれば時刻と名前を言い、読めなければ時刻を言わない', () => {
    expect(saveConflictTitle('', 'リマインダ', ' 予約前日のご案内 ')).toBe('ほかの人が先にリマインダ「予約前日のご案内」を保存しました')
    expect(saveConflictTitle('壊れた値', 'フォーム', '')).toBe('ほかの人が先にこのフォームを保存しました')
    expect(saveConflictTitle('2026-10-07T05:02:00Z', 'リマインダ', 'A')).toMatch(/^ほかの人が .+ にリマインダ「A」を保存しました$/)
  })
})

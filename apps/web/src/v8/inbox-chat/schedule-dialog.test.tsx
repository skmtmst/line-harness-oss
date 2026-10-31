// @vitest-environment happy-dom
/*
 * ★V8「予約して送る」の窓（ 段2「6.」）。書く欄の上の段ではなく窓で開く。
 * - すぐ選ぶで日時が入り、ボタンの文字がその日時になる
 * - 予約するを押すと画面の予約の処理を呼ぶ（送らない）
 * - 夜中（22時〜8時）は注意を出す
 * - 予約中は取り消せる。送信中のものは取り消せない
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ScheduleSendDialog, { type ScheduledRowView } from './schedule-dialog'

const NOW = new Date('2026-10-01T06:30:00Z') // 木曜 15:30 JST

function Harness({ onConfirm, onCancelRow, rows = [], initial = '', content = 'ソラさん、明日の 10:30 でお待ちしております。\n2行目', hasImage = false, attachmentLabel }: { onConfirm: () => void; onCancelRow?: (id: string) => void; rows?: ScheduledRowView[]; initial?: string; content?: string; hasImage?: boolean; attachmentLabel?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <ScheduleSendDialog
      open
      onClose={() => undefined}
      content={content}
      hasImage={hasImage}
      attachmentLabel={attachmentLabel}
      value={value}
      onChange={setValue}
      onConfirm={onConfirm}
      busy={false}
      rows={rows}
      rowsFailed={false}
      onRetryRows={() => undefined}
      onReschedule={() => undefined}
      onCancelRow={onCancelRow ?? (() => undefined)}
      now={NOW}
    />
  )
}

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('予約して送るの窓', () => {
  test('空の本文・日時では予約できず、理由が1つだけ出る。両方そろうと予約できる', () => {
    const confirm = vi.fn()
    const view = render(<Harness onConfirm={confirm} content="   " />)
    const button = screen.getByRole('button', { name: 'この日時で予約する' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getAllByText('送るものを入力してください')).toHaveLength(1)
    fireEvent.click(button); expect(confirm).not.toHaveBeenCalled()
    view.rerender(<Harness onConfirm={confirm} content="お知らせ" />)
    expect(button.disabled).toBe(true)
    expect(screen.getAllByText('送る日時を選んでください')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '明日 9:00', exact: true }))
    expect(button.disabled).toBe(false)
    expect(screen.queryByText('送る日時を選んでください')).toBeNull()
    fireEvent.click(button); expect(confirm).toHaveBeenCalledOnce()
  })
  test.each([{ hasImage: true }, { attachmentLabel: '動画「案内.mp4」' }])('本文が空でも準備済みの添付と日時があれば予約できる: %j', props => {
    const confirm = vi.fn()
    render(<Harness onConfirm={confirm} content="" initial="2026-10-02T09:00" {...props} />)
    const button = screen.getByRole('button', { name: '10/2 9:00 に予約' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    fireEvent.click(button); expect(confirm).toHaveBeenCalledOnce()
  })
  test('送るものに本文の1行目を出し、すぐ選ぶで日時が入って予約できる', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    expect(screen.getByRole('dialog', { name: '予約して送る' })).toBeTruthy()
    expect(screen.getByText('「ソラさん、明日の 10:30 でお待ちしております。」')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '明日 9:00' }))
    expect(screen.getByRole('button', { name: '明日 9:00' }).getAttribute('aria-pressed')).toBe('true')
    const confirm = screen.getByRole('button', { name: '10/2 9:00 に予約' })
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  test('相手が夜中になる日時は注意を出す', () => {
    render(<Harness onConfirm={() => undefined} initial="2026-10-02T23:00" />)
    expect(screen.getByText('相手が夜中の時間です。送ってよいか確かめてください。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '明日 13:00' }))
    expect(screen.queryByText('相手が夜中の時間です。送ってよいか確かめてください。')).toBeNull()
  })

  test('予約中は取り消せる。送信中は取り消せない', () => {
    const onCancelRow = vi.fn()
    render(<Harness onConfirm={() => undefined} onCancelRow={onCancelRow} rows={[
      { id: 'a', label: '10/2 9:00', content: '前日のご案内', editable: true, defaultValue: '2026-10-02T09:00' },
      { id: 'b', label: '10/3 9:00（送信中）', content: '当日のご案内', editable: false, defaultValue: '2026-10-03T09:00' },
    ]} />)
    const cancels = screen.getAllByRole('button', { name: '予約を取り消す' })
    fireEvent.click(cancels[0])
    expect(onCancelRow).toHaveBeenCalledWith('a')
    expect((cancels[1] as HTMLButtonElement).disabled).toBe(true)
  })
})

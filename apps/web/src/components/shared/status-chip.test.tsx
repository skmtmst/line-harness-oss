import React from 'react'
import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import StatusChip, { STATUS_CHIP_HELP, type StatusChipStatus } from './status-chip'

const ALL: StatusChipStatus[] = ['draft', 'ready', 'reserved', 'running', 'paused', 'ended']

describe('StatusChip（状態の札・設計 B）', () => {
  test('6つの言葉を出す', () => {
    const out = ALL.map((status) => renderToStaticMarkup(<StatusChip status={status} />)).join('')
    for (const label of ['下書き', '準備完了', '予約中', '稼働中', '停止中', '終了']) {
      expect(out).toContain(label)
    }
    // 画面ごとの古い言い方は出さない。
    for (const old of ['配信可', '開始予定', '有効', '公開中']) {
      expect(out).not.toContain(old)
    }
  })

  test('稼働中だけが緑（成功）の札', () => {
    const running = renderToStaticMarkup(<StatusChip status="running" />)
    expect(running).toContain('稼働中')
    // Tone は StatusBadge の success に1本化する（自前の緑を持たない）。
    const src = renderToStaticMarkup(<StatusChip status="paused" />)
    expect(src).toContain('停止中')
    expect(src).not.toContain('稼働中')
  })

  test('「？」は付けたい場所だけ', () => {
    const plain = renderToStaticMarkup(<StatusChip status="running" />)
    expect(plain).not.toContain('の説明')
    // 中身は押して開く吹き出し（静的書き出しには載らない）。「？」の口があることだけ見る。
    const helped = renderToStaticMarkup(<StatusChip status="running" withHelp />)
    expect(helped).toContain('稼働中の説明')
    expect(STATUS_CHIP_HELP.running).toContain('いま動いている')
  })
})

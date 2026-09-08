import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const inbox = readFileSync(new URL('./support-inbox.tsx', import.meta.url), 'utf8')

describe('問い合わせ一覧の定期取得 (#630)', () => {
  it('5秒起点の1本だけで一覧と会話を更新し、自前の setInterval は持たない', () => {
    expect(inbox).toContain('startVisiblePoll')
    expect(inbox).not.toContain('setInterval')
    // 一覧と会話は同じ1本の中で取り直す(同時1本)。
    expect(inbox).toContain('loadInbox(true)')
    expect(inbox).toContain('loadDetail(selected.threadId, true)')
  })

  it('未解決の間だけ動かし、対応済み・すべて表示では回さない', () => {
    const shouldLine = inbox
      .slice(inbox.indexOf('shouldPoll: () => status'))
      .split('\n')[0]
    expect(shouldLine).toContain("status === 'open'")
    expect(shouldLine).toContain("status === 'unread'")
    expect(shouldLine).toContain("status === 'in_progress'")
    expect(shouldLine).toContain("status === 'on_hold'")
    expect(shouldLine).not.toContain('resolved')
    expect(shouldLine).not.toContain("'all'")
  })

  it('静かな取り直しは成否を返し、失敗は投げて数え直す', () => {
    expect(inbox).toContain('Promise<boolean>')
    expect(inbox).toContain('onGiveUp')
    expect(inbox).toContain('onRecovered')
  })

  it('上限後は理由と再試行ボタンを出す', () => {
    expect(inbox).toContain('inboxStalled')
    expect(inbox).toContain('お問い合わせ一覧の更新を一時停止しています')
    expect(inbox).toContain('再試行する')
  })
})

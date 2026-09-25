// @vitest-environment happy-dom
/*
 * ダッシュボード「現在の対応状況」カードの回帰試験。
 *
 * 受信箱の絞り込みと同じ定義・同じ範囲で数える（正本は
 * `getInboxStatusCounts`）。押さえる契約:
 * - 4つの状態（未対応・対応中・保留・対応済み）を出す
 * - 単位は受信箱に合わせて「件」（LINE=友だち単位・MAIL=メール単位の合計）
 * - 各状態を押すと、その状態で絞った受信箱（/chats?status=）へ行く
 * - 取れていない状態は「—」（0件と見せない）。段階配備中の旧Workerは
 *   保留・内訳を返さないため、その間も「—」になる
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
    <a href={href} {...(rest as object)}>{children as never}</a>,
}))

import { SupportMarkStatusCard } from './side-cards'

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => { root?.unmount() })
  container?.remove()
  root = null
  container = null
})

function render(inbox: Parameters<typeof SupportMarkStatusCard>[0]['inbox']) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(<SupportMarkStatusCard inbox={inbox} autoOnInbound={null} />)
  })
  return container
}

const fullInbox = {
  unanswered: 2,
  inProgress: 3,
  onHold: 1,
  resolved: 10,
  line: { unanswered: 0, inProgress: 3, onHold: 0, resolved: 9 },
  email: { unanswered: 2, inProgress: 0, onHold: 1, resolved: 1 },
  oldestUnansweredMinutes: 30,
  averageFirstReplyMinutes: null,
}

describe('SupportMarkStatusCard（現在の対応状況）', () => {
  it('4つの状態を件で出し、それぞれ絞り込み済みの受信箱へつなぐ', () => {
    const el = render(fullInbox)
    const links = [...el.querySelectorAll('a')] as HTMLAnchorElement[]
    const byLabel = (label: string) => links.find((a) => a.textContent?.includes(label))
    expect(byLabel('未対応')?.textContent).toContain('2件')
    expect(byLabel('対応中')?.textContent).toContain('3件')
    expect(byLabel('保留')?.textContent).toContain('1件')
    expect(byLabel('対応済み')?.textContent).toContain('10件')
    expect(byLabel('未対応')?.getAttribute('href')).toBe('/chats?status=unread')
    expect(byLabel('対応中')?.getAttribute('href')).toBe('/chats?status=in_progress')
    expect(byLabel('保留')?.getAttribute('href')).toBe('/chats?status=on_hold')
    expect(byLabel('対応済み')?.getAttribute('href')).toBe('/chats?status=resolved')
    // 人単位に混ぜない。
    expect(el.textContent).not.toContain('2人')
  })

  it('取れていないときは「—」にし、0件と見せない', () => {
    const el = render(null)
    expect(el.textContent).toContain('未対応')
    expect(el.querySelectorAll('a').length).toBeGreaterThan(0)
    expect(el.textContent).toContain('—')
    expect(el.textContent).not.toContain('0件')
  })

  it('旧Workerの形（保留・内訳なし）でも落ちず、保留は「—」になる', () => {
    const el = render({
      unanswered: 2,
      inProgress: 0,
      resolved: 1,
      oldestUnansweredMinutes: null,
      averageFirstReplyMinutes: null,
    })
    const links = [...el.querySelectorAll('a')] as HTMLAnchorElement[]
    const hold = links.find((a) => a.textContent?.includes('保留'))
    expect(hold?.textContent).toContain('—')
    expect(hold?.textContent).not.toContain('0件')
  })
})

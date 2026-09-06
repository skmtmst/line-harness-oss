import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const OVERVIEWS = readFileSync(join(HERE, 'webhook-overviews.tsx'), 'utf8')

describe('V6 外部連携の一覧状態', () => {
  it('受信と送信を別々に読込・成功・失敗へ分ける', () => {
    expect(PAGE).toContain("type LoadStatus = 'loading' | 'ready' | 'error'")
    expect(PAGE).toContain("const [incomingStatus, setIncomingStatus]")
    expect(PAGE).toContain("const [outgoingStatus, setOutgoingStatus]")
    expect(PAGE).toContain("setIncomingStatus('error')")
    expect(PAGE).toContain("setOutgoingStatus('error')")
  })

  it('一方だけ失敗しても、取得できた側を表示できる', () => {
    expect(PAGE).toContain('Promise.allSettled')
    expect(PAGE).toContain("incomingResult.status === 'fulfilled' && incomingResult.value.success")
    expect(PAGE).toContain("outgoingResult.status === 'fulfilled' && outgoingResult.value.success")
  })

  it('アカウント切替前の遅い応答で現在の一覧を上書きしない', () => {
    expect(PAGE).toContain('const requestGeneration = ++loadGenerationRef.current')
    expect(PAGE).toContain('loadGenerationRef.current !== requestGeneration')
    expect(PAGE).toContain('selectedAccountIdRef.current !== requestAccountId')
  })

  it('失敗を空状態や古い一覧として表示しない', () => {
    const outgoingStart = OVERVIEWS.indexOf('export function OutgoingOverview')
    const incomingStart = OVERVIEWS.indexOf('export function IncomingOverview')
    const outgoing = OVERVIEWS.slice(outgoingStart, incomingStart)
    const incoming = OVERVIEWS.slice(incomingStart)
    expect(outgoing.indexOf("status === 'error'")).toBeGreaterThan(-1)
    expect(outgoing.indexOf('items.length === 0 && !showCreate')).toBeGreaterThan(outgoing.indexOf("status === 'error'"))
    expect(incoming.indexOf("status === 'error'")).toBeGreaterThan(-1)
    expect(incoming.indexOf('!selected && !showCreate')).toBeGreaterThan(incoming.indexOf("status === 'error'"))
    expect(OVERVIEWS.match(/登録内容は消えていません。/g)).toHaveLength(2)
    expect(PAGE).toContain("setIncoming([])\n      setIncomingStatus('error')")
    expect(PAGE).toContain("setOutgoing([])\n      setOutgoingStatus('error')")
  })

  it('失敗時に再読み込みできる', () => {
    expect(PAGE.match(/onReload=\{\(\) => void load\(\)\}/g)).toHaveLength(2)
    expect(OVERVIEWS.match(/onClick=\{onReload\}/g)).toHaveLength(2)
  })
})

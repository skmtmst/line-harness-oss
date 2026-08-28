import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

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
    expect(PAGE).toContain('const loadRequestRef = useRef(0)')
    expect(PAGE).toContain('const requestId = ++loadRequestRef.current')
    expect(PAGE).toContain('if (requestId !== loadRequestRef.current) return')
  })

  it('失敗を空状態や古い一覧として表示しない', () => {
    const errorBranch = PAGE.indexOf("activeStatus === 'error'")
    const emptyBranch = PAGE.indexOf("incoming.length === 0 && !showCreate")
    expect(errorBranch).toBeGreaterThan(-1)
    expect(emptyBranch).toBeGreaterThan(errorBranch)
    expect(PAGE).toContain('登録内容は消えていません。')
    expect(PAGE).toContain("setIncoming([])\n      setIncomingStatus('error')")
    expect(PAGE).toContain("setOutgoing([])\n      setOutgoingStatus('error')")
  })

  it('失敗時に再読み込みできる', () => {
    expect(PAGE).toContain('onClick={() => void load()}')
    expect(PAGE).toContain('{activeLabel}を再読み込み')
  })
})

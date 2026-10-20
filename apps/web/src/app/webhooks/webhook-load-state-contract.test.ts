import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readUiSource(join(HERE, 'page.tsx'), 'utf8')
const OVERVIEWS = ['outgoing', 'incoming'].map(name => readUiSource(join(import.meta.dirname, '../../v8/webhooks', `${name}.tsx`), 'utf8')).join('\n')

describe("管理画面 外部連携の一覧状態", () => {
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
    expect(PAGE).toContain('const generation = ++generationRef.current')
    expect(PAGE).toContain('generationRef.current !== generation')
    expect(PAGE).toContain('accountRef.current !== accountId')
  })

  it('失敗を空状態や古い一覧として表示しない', () => {
    const outgoing = readUiSource(join(HERE, '../../v8/webhooks/outgoing.tsx'), 'utf8')
    const incoming = readUiSource(join(HERE, '../../v8/webhooks/incoming.tsx'), 'utf8')
    expect(outgoing.indexOf("outgoingStatus === 'error'")).toBeGreaterThan(-1)
    expect(outgoing.indexOf('visible.length === 0')).toBeGreaterThan(outgoing.indexOf("outgoingStatus === 'error'"))
    expect(incoming).toContain("incomingStatus === 'error'")
    expect(incoming).toContain("incomingStatus === 'ready' && !selected")
    expect(outgoing).toContain('登録内容は消えていません。')
    expect(incoming).toContain('受け取り口を読み込めませんでした')
    expect(PAGE).toContain("setIncoming([])\n      setIncomingStatus('error')")
    expect(PAGE).toContain("setOutgoing([])\n      setOutgoingStatus('error')")
  })

  it('失敗時に再読み込みできる', () => {
    expect(PAGE).toContain('onRetry={() => void reload()}')
    // ★管理画面 `x63W5x`：古い個別ボタン（`action`）ではなく、共通の再読み込み口（`onRetry`）。
    expect(OVERVIEWS.match(/onRetry=\{[^}]*\}/g)).toHaveLength(3)
    expect(OVERVIEWS).not.toContain('onClick={onReload}')
  })
})

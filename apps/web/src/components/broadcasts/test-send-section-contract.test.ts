import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const section = readFileSync(join(here, 'test-send-section.tsx'), 'utf8')

describe('V6 テスト送信（h0kahp）', () => {
  it('素のTailwind色と直書きの色を残さない', () => {
    for (const raw of [
      'text-blue-500',
      'text-red-600',
      'text-green-600',
      'border-gray-200',
      'text-gray-700',
      'text-gray-500',
      'text-gray-400',
      'bg-white',
      '#3B82F6',
      'style={{ backgroundColor',
    ]) {
      expect(section, `${raw} が残っている`).not.toContain(raw)
    }
    expect(section).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('色・枠・角丸をV6トークンで書く', () => {
    for (const token of [
      'bg-canvas',
      'border-hairline',
      'rounded-card',
      'rounded-control',
      'text-ink-secondary',
      'text-ink-faint',
      'text-action',
      'bg-action',
      'text-on-action',
      'text-danger',
      'text-success',
    ]) {
      expect(section, `${token} を使っていない`).toContain(token)
    }
  })

  it('宛先の読込中・読込失敗を「未設定」と混ぜない', () => {
    expect(section).toContain("useState<'loading' | 'ready' | 'error'>('loading')")
    expect(section).toContain('読み込んでいます')
    expect(section).toContain('テスト送信先を読み込めませんでした')
    expect(section).toContain('テスト送信先が未設定です')
  })

  it('送信の失敗応答を黙って捨てない', () => {
    // 成功だけ拾って else が無いと、押しても何も出ない画面になる。
    const body = section.slice(section.indexOf('const handleTestSend'), section.indexOf('} finally {'))
    expect(body).toMatch(/if \(res\.success\) \{[\s\S]*?\} else \{[\s\S]*?testSendFailure/)
    expect(body).toContain('testSendResult(')
  })

  it('アカウントや配信が変わったら前の結果を捨て、遅い返事を映さない', () => {
    expect(section).toContain('identityRef.current.accountId === request.accountId')
    expect(section).toContain('identityRef.current.broadcastId === request.broadcastId')
    expect(section).toContain('sendGenerationRef.current === request.generation')
    expect(section).toContain('setResult(null)')
    expect(section).toContain('if (!isCurrentRequest()) return')
  })
})

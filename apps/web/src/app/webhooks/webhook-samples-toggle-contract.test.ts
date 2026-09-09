import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('N-381 見本タブは外部連携の中で開く', () => {
  test('別機能の通知画面を埋め込まない', () => {
    expect(source).not.toContain('NotificationsPage')
    expect(source).not.toContain('@/app/notifications')
  })

  test('見本タブは外部連携の見本パネルを開く', () => {
    expect(source).toContain('WebhookSamples')
    expect(source).toContain("{tab === 'notify' && <WebhookSamples />}")
  })

  test('受け取る見本は種類を選んだ状態の作成へつなげる', () => {
    expect(source).toContain('tab=incoming&source=')
    // 見本に無い値は無視し、空のままにする。
    expect(source).toContain("searchParams.get('source')")
    expect(source).toContain('SOURCE_PRESETS.some')
  })

  test('送る見本は送り先の作成へつなげる', () => {
    expect(source).toContain('OUTGOING_SAMPLES')
    expect(source).toContain('href="/webhooks/new"')
  })
})

describe('N-382 開始/停止の二重押しで意図と逆にならない', () => {
  test('送信中の行の再押下を受け付けない（受信・送信の2つ）', () => {
    expect(source.match(/if \(togglingIdsRef\.current\.has\(key\)\) return/g)).toHaveLength(2)
    expect(source.match(/togglingIdsRef\.current\.add\(key\)/g)).toHaveLength(2)
  })

  test('応答の成否にかかわらず送信中の印を外す（受信・送信の2つ）', () => {
    expect(source.match(/togglingIdsRef\.current\.delete\(key\)/g)).toHaveLength(2)
    expect(source).toContain('finally')
  })

  test('成功時だけ一覧を読み直してサーバ状態へ寄せる', () => {
    expect(source).toContain('if (selectedAccountIdRef.current === requestAccountId) await load()')
  })

  test('失敗時は状態を変えず次に何をすべきか出す', () => {
    expect(source).toContain('状態は変わっていません')
    expect(source).toContain('もう一度お試しください')
  })

  test('行ごとに印を持つので他の行の操作は止めない', () => {
    expect(source).toContain('useRef<Set<string>>(new Set())')
    expect(source).toContain('setToggleFailures((current) => ({')
    expect(source).toContain('data-webhook-toggle-error={key}')
  })
})

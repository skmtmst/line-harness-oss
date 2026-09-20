import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(import.meta.dirname, 'webhook-interactions.tsx'), 'utf8')
const HOST = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')
const API = readFileSync(join(import.meta.dirname, '..', '..', 'lib', 'api.ts'), 'utf8')

describe('V6 外部連携・やり取りの記録 KNG00', () => {
  it('実ノードと実ルートを接続する', () => {
    expect(PAGE).toContain('data-design-node="KNG00"')
    expect(HOST).toContain("{ key: 'interactions', label: 'やり取りの記録' }")
    expect(HOST).toContain("{ key: 'outgoing', label: 'こちらから送る' }")
    expect(HOST).toContain("tab === 'interactions' && <WebhookInteractions />")
    expect(API).toContain('/api/webhooks/interactions?')
  })

  it('タブの件数は固定値でなく、一覧の取得結果の総数に接続する(#980)', () => {
    // 設計が描いた作り物の件数を書かない。一覧0件のアカウントでも
    // 「こちらから送る 6」「こちらで受け取る 3」と出ていた。
    expect(HOST).not.toContain("'こちらから送る 6'")
    expect(HOST).not.toContain("'こちらで受け取る 3'")
    expect(HOST).not.toContain("'見本 14'")
    // 「送る」「受け取る」は、選択中アカウントで絞った一覧と同じ配列の
    // 総数を、取れたとき（status==='ready'）だけ付ける。
    expect(HOST).toContain("outgoingStatus === 'ready'")
    expect(HOST).toContain("incomingStatus === 'ready'")
    expect(HOST).toContain('`${item.label} ${outgoing.length}`')
    expect(HOST).toContain('`${item.label} ${incoming.length}`')
    // 「見本」は画面に並べる見本データから別集計する。
    expect(HOST).toContain('`見本 ${SOURCE_PRESETS.length + OUTGOING_SAMPLES.length}`')
  })

  it('読込・空・失敗を分け、未取得を0件と見せない', () => {
    expect(PAGE).toContain('kind="loading"')
    expect(PAGE).toContain('kind="empty"')
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('value={data.summary.averageDurationMs == null ? null')
    expect(PAGE).toContain("if (averageDurationMs == null) return '未取得'")
  })

  it('URL・シークレット・本文を画面へ出さず、内部エラーも表示しない', () => {
    expect(PAGE).toContain('接続先URL、シークレット、本文は安全のため表示しません。')
    expect(PAGE).toContain('title={item.triggerSummary}>{item.triggerSummary}')
    expect(PAGE).toContain('安全のため本文と接続情報は一覧に表示しません')
    expect(PAGE).not.toContain('API error:')
    expect(PAGE).not.toContain('Failed to fetch')
    expect(PAGE).not.toContain('requestBodyJson')
    expect(PAGE).not.toContain('idempotencyKey')
  })

  it('送り直しは管理者だけに見せ、単体と一括の両方を持つ', () => {
    expect(PAGE).toContain("role === 'owner' || role === 'admin'")
    expect(PAGE).toContain('失敗したものをまとめてやり直す')
    expect(PAGE).toContain("canRetry && item.canRetry ? <Button")
  })

  it('アカウント切替後に前の記録や送り直し結果を表示しない', () => {
    expect(PAGE).toContain('const requestGeneration = ++loadGenerationRef.current')
    expect(PAGE).toContain('loadGenerationRef.current !== requestGeneration')
    expect(PAGE).toContain('selectedAccountIdRef.current !== requestAccountId')
    expect(PAGE).toContain('loadedAccountId !== requestAccountId')
    expect(PAGE).toContain('if (selectedAccountIdRef.current === requestAccountId) setRetrying(null)')
    expect(PAGE).toContain('if (selectedAccountIdRef.current === requestAccountId) setBulkRetrying(false)')
  })

  it('本文に画面タイトルや説明を重ねない', () => {
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).not.toContain('<h1')
  })
})

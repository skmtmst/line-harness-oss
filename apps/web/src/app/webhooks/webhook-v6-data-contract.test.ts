import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const API = readFileSync(join(HERE, '../../lib/api.ts'), 'utf8')
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const OVERVIEWS = readFileSync(join(HERE, 'webhook-overviews.tsx'), 'utf8')

describe('V6 外部連携の接続別集計と受信口詳細', () => {
  it('送信一覧を接続別集計つきの型で受け取る', () => {
    expect(API).toContain('export type OutgoingWebhookOverview = OutgoingWebhook &')
    expect(API).toContain('deliverySummary: {')
    expect(API).toContain('fetchApi<ApiResponse<OutgoingWebhookOverview[]>>')
    expect(PAGE).toContain('useState<OutgoingWebhookOverview[]>([])')
  })

  it('送信回数・失敗・再送可否を画面へ反映する', () => {
    expect(OVERVIEWS).toContain('item.deliverySummary.total.toLocaleString')
    expect(OVERVIEWS).toContain('item.deliverySummary.failed > 0')
    expect(OVERVIEWS).toContain('item.deliverySummary.canRetry')
    expect(OVERVIEWS).toContain("const [sort, setSort] = useState<OutgoingSort>('volume')")
    expect(OVERVIEWS).toContain('送った回数が多い順')
    expect(OVERVIEWS).not.toContain('接続別集計待ち')
  })

  it('送信先へテスト送信できる', () => {
    expect(API).toContain('/api/webhooks/outgoing/${encodeURIComponent(id)}/test')
    expect(OVERVIEWS).toContain('api.webhooks.outgoing.test(item.id, lineAccountId)')
    expect(OVERVIEWS).toContain('1回 試してみる')
    expect(OVERVIEWS).toContain("item.deliverySummary.canRetry ? '失敗をやり直す' : '中身を見る'")
    expect(OVERVIEWS).toContain('aria-expanded={settingsId === item.id}')
  })

  it('選んだ受け取り口の詳細をアカウント付きで取得する', () => {
    expect(API).toContain('/api/webhooks/incoming/${encodeURIComponent(id)}?lineAccountId=${encodeURIComponent(lineAccountId)}')
    expect(PAGE).toContain('lineAccountId={selectedAccountId}')
    expect(OVERVIEWS).toContain('api.webhooks.incoming.detail(selectedDetailId, lineAccountId)')
    expect(OVERVIEWS).toContain('if (cancelled) return')
  })

  it('照合・処理名・マスク済み見本・差し込み項目だけを表示する', () => {
    expect(OVERVIEWS).toContain('identityMatchingLabel(detail)')
    expect(OVERVIEWS).toContain('incomingActionLabel(action.refKind)')
    expect(OVERVIEWS).toContain('{action.displayName}')
    expect(OVERVIEWS).toContain('maskedSampleText(detail.latestSample.fields)')
    expect(OVERVIEWS).toContain('{field.token}')
    expect(OVERVIEWS).not.toContain('{action.refId}')
    expect(OVERVIEWS).not.toContain('照合方法のAPI待ち')
    expect(OVERVIEWS).not.toContain('最近届いた本文を安全にマスクして返すAPIがまだありません')
  })

  it('詳細取得に失敗しても一覧を消さず、詳細だけ再読込できる', () => {
    expect(OVERVIEWS).toContain("setDetailStatus('error')")
    expect(OVERVIEWS).toContain('届いた後の処理を表示できませんでした')
    expect(OVERVIEWS).toContain('setDetailReloadKey((key) => key + 1)')
  })
})

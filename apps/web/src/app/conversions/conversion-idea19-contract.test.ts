import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')
const API = readFileSync(join(import.meta.dirname, '..', '..', 'lib', 'api.ts'), 'utf8')

/**
 * #1037 IDEA-19「19 コンバージョン」の契約。
 *
 * - 成果名の下に1件ごとの状態(確定・確認待ち・却下・取消)を業務の言葉で出す。
 * - 外部受信の失敗理由はコードではなく業務の言葉で出す。
 * - 検証の受信(test:true)は本番実績と区別して出す。成果表には書かない。
 * - 状態の導出は口が担い、画面は組み立て直さない。
 */
describe('コンバージョン詳細の業務文言(#1037 IDEA-19)', () => {
  it('成果1件の状態を「確定・確認待ち・却下・取消」で出す', () => {
    expect(PAGE).toContain("confirmed: '確定'")
    expect(PAGE).toContain("pending: '確認待ち'")
    expect(PAGE).toContain("rejected: '却下'")
    expect(PAGE).toContain("cancelled: '取消'")
    expect(PAGE).toContain('EVENT_STATUS_LABELS[event.status]')
  })

  it('外部受信の失敗理由はコードを出さず業務の言葉へ訳す', () => {
    expect(PAGE).toContain('INGEST_REASON_LABELS')
    expect(PAGE).toContain("signature_mismatch: '署名が一致しませんでした。連携先の鍵を確認してください'")
    expect(PAGE).toContain("source_event_id_missing: '送信側のイベントIDが無いため、重複かどうかを判定できませんでした'")
    // 生の理由コードをそのまま画面へ出さない。
    expect(PAGE).not.toContain('（${event.reason}）')
  })

  it('検証の受信は本番実績と区別して名乗る', () => {
    expect(PAGE).toContain('検証の受信（実績には数えません）')
    expect(PAGE).toContain('検証の受信（受け取れなかった）')
    expect(PAGE).toContain('event.isTest')
  })

  it('成果一覧の読み込み失敗は静かに空へ倒さない', () => {
    expect(PAGE).toContain('setEventsFailed(true)')
    expect(PAGE).toContain('成果の記録を読み込めませんでした')
  })

  it('口は1件ずつの一覧と検証目印を持つ', () => {
    expect(API).toContain('ConversionDefinitionEvent')
    expect(API).toContain('isTest: boolean')
    expect(API).toContain('/events?limit=')
  })
})

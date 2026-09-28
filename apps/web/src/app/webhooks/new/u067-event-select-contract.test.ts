import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * #975 U067: 送るイベントをCSV文字列で手入力させない。
 * 正本は packages/db/src/webhooks.ts の KNOWN_OUTGOING_EVENT_TYPES。
 */
describe('Webhookイベントの選択（#975 U067）', () => {
  it('CSV入力欄を持たない', () => {
    expect(PAGE).not.toContain('id="wh-events"')
    expect(PAGE).not.toContain('カンマ区切り。* を入れると')
    expect(PAGE).not.toContain("eventTypes\n            .split(',')")
  })

  it('「すべて送る」か「選ぶ」の2択＋チェックの選択肢', () => {
    expect(PAGE).toContain('すべてのイベントを送る')
    expect(PAGE).toContain('送るイベントを選ぶ')
    expect(PAGE).toContain('type="checkbox"')
    expect(PAGE).toContain('WEBHOOK_EVENT_GROUPS')
  })

  it('選択肢は正本の種別コードを使う', () => {
    for (const code of [
      'friend_add', 'friend_unfollow', 'message_received', 'postback_received',
      'tag_change', 'staff_assigned', 'manual_reply_sent', 'cv_fire',
      // R150: 見本にある「フォームが送られた」「予約が入った」は
      // 実際に発火する種別（forms.ts / booking.ts が発火元）。
      'form_submitted', 'booking_created',
    ]) {
      expect(PAGE).toContain(`value: '${code}'`)
    }
    // ECの出来事は共有の正本から描く。
    expect(PAGE).toContain('EC_EVENT_TYPES.map')
    expect(PAGE).toContain('ecEventLabel(value)')
  })

  /*
   * R150: /webhooks の見本は ?event=<種類> で開き、その種別だけを
   * 初期選択する。来た値がカタログに無ければ「すべて送る」ではなく
   * なにも選ばない状態にはせず、明示操作だけが全イベントを選べる。
   */
  it('?event= の見本条件を初期選択にし、知らない値は全選択へ丸めない', () => {
    expect(PAGE).toContain('useSearchParams')
    expect(PAGE).toContain("searchParams.get('event')")
    expect(PAGE).toContain('useState(!presetValid)')
    expect(PAGE).toContain('useState<string[]>(presetValid ? [presetEvent!] : [])')
    // useSearchParams は静的書き出しのため Suspense の内側に置く。
    expect(PAGE).toContain('<Suspense')
  })

  it('「すべて送る」は * として送り、受信Webhookの種類IDは詳細設定に置く', () => {
    expect(PAGE).toContain("? ['*']")
    expect(PAGE).toContain('incoming_webhook.${value}')
    expect(PAGE).toContain('送るイベントを選ぶか、「すべてのイベントを送る」を選んでください')
  })
})

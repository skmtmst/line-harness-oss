import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * 全ルート監査 A3（2026-09-25）: `/scenarios/results?id=scenario-0` の
 * 「次の配信」が ISO（`2026-09-06T11:00:00.000Z`）のまま出ていた。
 * 日本時間の「9/6 20:00」形式にする。整形は既存の `shortDateTime` を使う。
 */
const PAGE = readFileSync(join(process.cwd(), 'src/app/scenarios/results/page.tsx'), 'utf8')
const DIALOGS = readFileSync(join(process.cwd(), 'src/components/scenarios/scenario-dialogs.tsx'), 'utf8')

describe('シナリオ結果の次の配信の日時表示', () => {
  it('一覧の「次の配信」は既存の整形関数で日本時間にする', () => {
    expect(PAGE).toContain('shortDateTime(sub.nextDeliveryAt)')
    expect(PAGE).not.toContain(': sub.nextDeliveryAt ?? ')
  })

  it('予定ダイアログの「次の配信予定」も同じ整形にする', () => {
    expect(DIALOGS).toContain('shortDateTime(plan.subscription.nextDeliveryAt)')
  })
})

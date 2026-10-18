import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * R83: キャンセル待ちが自動か手動か、画面ごとに説明が逆だった回帰試験。
 *
 * 実際の動きは「空きが出たら待ちの先頭へ自動で案内が送られ、本人の承諾で
 * 確定する」（取消時に繰上げジョブを積み、定期処理が案内する）。手動の
 * 「次の方へ案内」も申込者の画面にある。3つの画面の説明を自動にそろえる。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const FORM = readFileSync(join(HERE, '..', '..', 'v8', 'events', 'edit-form.tsx'), 'utf8')
const LIST = readFileSync(join(HERE, '..', '..', 'v8', 'events', 'list.tsx'), 'utf8')
const BOOKINGS = readFileSync(join(HERE, '..', '..', 'v8', 'events', 'bookings.tsx'), 'utf8')
// 取消→自動案内の配線はWorkerのevents.test.tsで実HTTP経路から検証する。

describe('R83 キャンセル待ちの説明は自動案内にそろえる', () => {
  it('公開設定は自動案内と本人承諾を説明し、手動だけの説明をしない', () => {
    expect(FORM).toContain('自動で案内が送られ')
    expect(FORM).toContain('本人が期限内に承諾すると確定します')
    expect(FORM).toContain('手動で次の方へ案内することもできます')
    expect(FORM).not.toContain('自動では繰り上げず')
  })

  it('一覧の帯と申込者の画面も自動の案内として読める', () => {
    expect(LIST).toContain('キャンセルが出たら、キャンセル待ちの人に自動で順番が回ります。')
    expect(BOOKINGS).toContain('空きが出たら先頭の方へ期限つきの案内を送ります')
  })

})

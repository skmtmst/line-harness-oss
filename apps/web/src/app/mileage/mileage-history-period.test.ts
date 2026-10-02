import { describe, expect, it } from 'vitest'

import { HISTORY_PERIOD_ERROR, validateHistoryPeriod } from './mileage-history-period'

describe('R304: 履歴の日付逆転は入力エラーにする', () => {
  it('開始日が終了日より後なら理由を返す', () => {
    expect(validateHistoryPeriod('2026-09-29', '2026-09-28')).toBe(HISTORY_PERIOD_ERROR)
  })

  it('同日・片側だけ・正しい範囲は取得してよい（null）', () => {
    expect(validateHistoryPeriod('2026-09-28', '2026-09-28')).toBeNull()
    expect(validateHistoryPeriod('', '2026-09-28')).toBeNull()
    expect(validateHistoryPeriod('2026-09-28', '')).toBeNull()
    expect(validateHistoryPeriod('', '')).toBeNull()
    expect(validateHistoryPeriod('2026-09-27', '2026-09-28')).toBeNull()
  })
})

/*
 * 受信箱の返事の期限の札（板 Fk2FC・G3）。守るのは：
 *  - 期限オフ・ふつう（余裕あり）は札を出さない（色を付けない）。
 *  - 期限まで15分以下＝金「あと 12 分」・過ぎた＝赤「20 分過ぎ」・1時間以上は「1 時間過ぎ」。営業時間の外は灰。
 *  - 担当の名前の後ろに、自動で決まったときだけ「（自動）」。
 */
import { describe, expect, it } from 'vitest'
import { assigneeLabel, slaBadgeOf } from './sla'

const now = Date.parse('2026-10-16T10:15:00.000Z')
const at = (minutes: number) => new Date(now + minutes * 60000).toISOString()

describe('slaBadgeOf', () => {
  it('期限オフ・ふつうは札なし', () => {
    expect(slaBadgeOf({}, now)).toBeNull()
    expect(slaBadgeOf({ slaState: 'none' }, now)).toBeNull()
    expect(slaBadgeOf({ slaState: 'ok', slaDueAt: at(40) }, now)).toBeNull()
  })
  it('あと12分は金、20分過ぎは赤、60分過ぎは「1 時間過ぎ」', () => {
    expect(slaBadgeOf({ slaState: 'soon', slaDueAt: at(12) }, now)).toEqual({ tone: 'warning', text: 'あと 12 分' })
    expect(slaBadgeOf({ slaState: 'overdue', slaDueAt: at(-20) }, now)).toEqual({ tone: 'danger', text: '20 分過ぎ' })
    expect(slaBadgeOf({ slaState: 'overdue', slaDueAt: at(-60) }, now)).toEqual({ tone: 'danger', text: '1 時間過ぎ' })
  })
  it('営業時間の外は灰', () => {
    expect(slaBadgeOf({ slaState: 'outside_hours', slaDueAt: at(300) }, now)).toEqual({ tone: 'neutral', text: '営業時間外' })
  })
})

describe('assigneeLabel', () => {
  it('自動で決まった担当だけ（自動）を付け、未割り当てはそのまま', () => {
    expect(assigneeLabel('Kenta', { assignedBy: 'auto' })).toBe('Kenta（自動）')
    expect(assigneeLabel('Kenta', { assignedBy: 'manual' })).toBe('Kenta')
    expect(assigneeLabel(null, { assignedBy: 'auto' })).toBe('未割り当て')
  })
})

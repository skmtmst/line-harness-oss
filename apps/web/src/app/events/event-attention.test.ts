import { describe, expect, it } from 'vitest'

import type { EventListItem } from '@/lib/api'
import {
  daysUntilEvent,
  describeBookingCapacity,
  summarizeEventAttention,
} from './event-attention'

const NOW = Date.parse('2026-08-25T00:00:00.000Z')

function event(
  id: string,
  startsAt: string,
  active: number,
  capacity: number | null,
  published = 1,
): EventListItem {
  return {
    id,
    name: id,
    venue_name: null,
    venue_url: null,
    image_url: null,
    description: null,
    description_centered: 0,
    max_bookings_per_friend: null,
    requires_approval: 0,
    cancel_deadline_hours_before: null,
    reminder_day_before_enabled: 0,
    reminder_hours_before: null,
    is_published: published,
    sort_order: 0,
    created_at: startsAt,
    updated_at: startsAt,
    next_slot_starts_at: startsAt,
    total_capacity: capacity,
    total_active: active,
    pending_count: 0,
    visible_tag_id: null,
    visible_tag_name: null,
  }
}

describe('イベント予約の行動につながる帯', () => {
  it('受付中の未来の回だけを日付順に数える', () => {
    const summary = summarizeEventAttention([
      event('later', '2026-08-30T00:00:00.000Z', 4, 10),
      event('past', '2026-08-24T00:00:00.000Z', 2, 10),
      event('draft', '2026-08-26T00:00:00.000Z', 2, 10, 0),
      event('near', '2026-08-27T00:00:00.000Z', 7, 10),
    ], NOW)

    expect(summary.upcoming.map((item) => item.id)).toEqual(['near', 'later'])
    expect(summary.applied).toBe(11)
    expect(summary.capacity).toBe(20)
    expect(summary.fillRate).toBe(55)
  })

  it('残り1〜3席だけをあと少しで満席にする', () => {
    const summary = summarizeEventAttention([
      event('three', '2026-08-27T00:00:00.000Z', 7, 10),
      event('four', '2026-08-28T00:00:00.000Z', 6, 10),
      event('full', '2026-08-29T00:00:00.000Z', 10, 10),
    ], NOW)

    expect(summary.nearlyFull.map((item) => item.id)).toEqual(['three'])
  })

  it('7日以内で定員の半分未満の回だけを申し込みが少ないとする', () => {
    const summary = summarizeEventAttention([
      event('low', '2026-08-28T00:00:00.000Z', 4, 10),
      event('half', '2026-08-29T00:00:00.000Z', 5, 10),
      event('far', '2026-09-05T00:00:00.000Z', 1, 10),
      event('unlimited', '2026-08-27T00:00:00.000Z', 0, null),
    ], NOW)

    expect(summary.lowApplications.map((item) => item.id)).toEqual(['low'])
    expect(daysUntilEvent(summary.lowApplications[0], NOW)).toBe(3)
  })

  it('申込者一覧も残り3席以下だけを声かけの目安にする', () => {
    expect(describeBookingCapacity(7, 10)).toBe('あと3人で満席です。声をかけると埋まります')
    expect(describeBookingCapacity(6, 10)).toBe('定員 10 ・ 残り4')
    expect(describeBookingCapacity(10, 10)).toBe('定員 10 ・ 満席です')
    expect(describeBookingCapacity(0, null)).toBe('定員なし')
  })
})

import type { FormRequirement } from '@/lib/form-requirement'

type NumberRule = FormRequirement<number | null | undefined>
export const ruleNumberRequirements: Record<'reminderHoursBefore' | 'slotGranularityMinutes' | 'holdMinutes', NumberRule> = {
  reminderHoursBefore: { required: false, check: value => value == null || Number.isInteger(value) && value >= 1 && value <= 72 ? null : '当日のお知らせは1〜72時間前で指定してください。' },
  slotGranularityMinutes: { required: true, check: value => [5,10,15,30,60].includes(value ?? -1) ? null : '予約枠の間隔は5・10・15・30・60分から指定してください。' },
  holdMinutes: { required: true, check: value => Number.isInteger(value) && value != null && value >= 1 && value <= 1440 ? null : '仮押さえの保持時間は1〜1440分で指定してください。' },
}

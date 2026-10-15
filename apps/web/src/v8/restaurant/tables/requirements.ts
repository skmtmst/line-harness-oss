import { requiredText } from '@/lib/form-requirement'

/** 空欄を拒否する保存条件と、入力欄の必須表示をそろえる。 */
export const tableRequirements = {
  draft_code: requiredText('卓番を入れてください。'),
  draft_label: requiredText('表示名を入れてください。'),
  draft_min_capacity: requiredText('最小人数は1以上の整数にしてください。'),
  draft_max_capacity: requiredText('最大人数は最小人数以上の整数にしてください。'),
}

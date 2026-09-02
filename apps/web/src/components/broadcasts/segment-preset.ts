import type { SavedSegmentPreset } from '@line-crm/shared'
import type { SegmentCondition } from '@/lib/segment-condition'

/** 保存済みの正本を、編集中の変更で書き換えないよう複製して返す。 */
export function conditionFromSegmentPreset(preset: SavedSegmentPreset): SegmentCondition {
  // APIが返す条件はJSONだけで構成される。値の配列・オブジェクトまで複製し、
  // ConditionBuilderでタグなどを変更しても保存済みの正本へ波及させない。
  return JSON.parse(JSON.stringify(preset.conditions.condition)) as SegmentCondition
}

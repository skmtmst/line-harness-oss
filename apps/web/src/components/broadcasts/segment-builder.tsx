'use client'

import { useState } from 'react'
import Button from '@/components/shared/button'
import ConditionBuilder from '@/components/shared/condition-builder'
import { pruneCondition, type SegmentCondition } from '@/lib/segment-condition'

interface SegmentBuilderProps {
  initialConditions?: SegmentCondition | null
  onApply: (conditions: SegmentCondition) => void
  onCancel: () => void
}

/**
 * 旧詳細画面でも、作成画面と同じ共通条件の形を編集する。
 * metadata_* 専用の別形式へ変換しないため、保存口へオブジェクトのまま渡せる。
 */
export default function SegmentBuilder({ initialConditions, onApply, onCancel }: SegmentBuilderProps) {
  const [draft, setDraft] = useState<SegmentCondition | null>(initialConditions ?? null)
  const usable = pruneCondition(draft)

  return (
    <div className="rounded-card border-hairline space-y-4 border bg-canvas p-4">
      <ConditionBuilder value={draft} onChange={setDraft} />
      <div className="border-hairline flex justify-end gap-2 border-t pt-3">
        <Button type="button" variant="secondary" onClick={onCancel}>キャンセル</Button>
        <Button
          type="button"
          variant="primary"
          disabled={!usable}
          onClick={() => { if (usable) onApply(usable) }}
        >
          適用
        </Button>
      </div>
    </div>
  )
}

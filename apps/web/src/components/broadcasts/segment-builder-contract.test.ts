import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const BUILDER = readFileSync(new URL('./segment-builder.tsx', import.meta.url), 'utf8')
const DETAIL = readFileSync(new URL('./broadcast-detail.tsx', import.meta.url), 'utf8')

describe('旧配信詳細の絞り込み条件', () => {
  it('作成画面と同じ共通条件部品を使い、条件をオブジェクトのまま保存する', () => {
    expect(BUILDER).toContain("import ConditionBuilder from '@/components/shared/condition-builder'")
    expect(BUILDER).not.toContain('metadata_equals')
    expect(BUILDER).not.toContain('metadata_not_equals')
    expect(DETAIL).toContain('segmentConditions: conditions')
    expect(DETAIL).not.toContain('segmentConditions: JSON.stringify(conditions)')
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const BUILDER = readFileSync(new URL('./segment-builder.tsx', import.meta.url), 'utf8')
/*
 * 旧詳細（`./broadcast-detail.tsx`）を消したため、条件をオブジェクトの
 * まま渡す側は作成画面（`./broadcast-form.tsx`）を見張る。意図は変えない。
 */
const FORM = readFileSync(new URL('./broadcast-form.tsx', import.meta.url), 'utf8')

describe('配信の絞り込み条件', () => {
  it('作成画面と同じ共通条件部品を使い、条件をオブジェクトのまま保存する', () => {
    expect(BUILDER).toContain("import ConditionBuilder from '@/components/shared/condition-builder'")
    expect(BUILDER).not.toContain('metadata_equals')
    expect(BUILDER).not.toContain('metadata_not_equals')
    expect(FORM).toContain('segmentConditions: audience')
    expect(FORM).not.toContain('segmentConditions: JSON.stringify')
  })
})

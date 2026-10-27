import { readUiSource } from '../../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { impactCsv } from '@/v8/common-vars-edit/impact'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readUiSource(join(HERE, 'page.tsx'), 'utf8')
const EXPORT_PANEL = readUiSource(join(HERE, '../../../v8/common-vars/export-panel.tsx'), 'utf8')
const IMPACT_REVIEW = readUiSource(join(HERE, '../../../v8/common-vars-edit/edit.tsx'), 'utf8')

/*
 * CSVまわりの動き（一括削除の上限・一覧の上限の知らせ・値欄の上限・撮影モックの予約口・CSVの無害化）は
 * 描いて押す試験と口の試験が守る：`src/v8/common-vars/list-delete.test.tsx`・`list-view.test.tsx`、
 * `edit/page-behavior.test.tsx`、`scripts/visual-qa/common-var-schedules-mock.test.ts`、
 * Worker の `common-var-exports.test.ts`（式注入文字を1セルへ保つ）。
 */
describe('#544 N7/L1 CSVの数式インジェクション対策と共通化', () => {
  it('一覧CSVを端末で作る形や、画面だけの無害化に戻さない', () => {
    expect(EXPORT_PANEL).not.toContain('commonVarsCsv')
    expect(PAGE).not.toContain('commonVarsCsv')
    expect(IMPACT_REVIEW).not.toContain('function csvCell')
  })

  it('影響一覧CSVは差し替え後の文を無害化する', () => {
    const csv = impactCsv({
      byKind: { template: 1 },
      items: [{
        name: '予約配信', kindLabel: '一斉配信', status: '配信予約中', blocksDeletion: true,
        changesOnSave: true, currentPreview: '前', nextPreview: '@evil', exceedsCharacterLimit: false,
      }],
    } as never)
    expect(csv).toContain("\"'@evil\"")
  })
})

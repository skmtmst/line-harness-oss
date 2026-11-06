import { readUiSource } from '../../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readUiSource(join(HERE, 'page.tsx'), 'utf8')
const EDIT_PAGE = readUiSource(join(HERE, 'edit', 'page.tsx'), 'utf8')

/*
 * 共通情報の一覧・編集の動きは、描いて押す試験が守る：
 * 一覧 `src/v8/common-vars/list-view.test.tsx`・`list-delete.test.tsx`、
 * 編集 `edit/page-behavior.test.tsx`・`edit/page-redisplay.test.tsx`、新規 `new/page-behavior.test.tsx`、
 * 機能キーの門 `feature-gate.test.tsx`、口 `src/lib/api.test.ts`、Worker `apps/worker/src/routes/contents.test.ts`。
 * ここは古い書き方へ戻さない禁止の見張りだけを残す。
 */
describe('共通情報の一覧・編集を古い形へ戻さない', () => {
  it('一覧は行ごとに予約を読まず、種別の列や表示名の差し込みに戻さない', () => {
    expect(PAGE).not.toContain('api.commonVars.schedules(item.id)')
    expect(PAGE).not.toContain('VAR_TYPE_LABELS[item.type]')
    expect(PAGE).not.toContain('placeholderText(item.name)')
  })

  it('編集はメモ・履歴の口が無いという古い案内や表示名の差し込みに戻さない', () => {
    expect(EDIT_PAGE).not.toContain('メモを読み書きするAPIがまだありません')
    expect(EDIT_PAGE).not.toContain('変更者と変更前後を返す履歴APIがまだありません')
    expect(EDIT_PAGE).not.toContain('placeholderText(item.name)')
  })
})

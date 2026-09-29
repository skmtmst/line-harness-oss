import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * R212・R215・R213（一覧と編集の直し）の再発防止。
 *
 * R212: 下書きの通が通常の通と同じ見た目で、送られる通と
 *   見分けられなかった。一覧の内容欄に共通の StatusChip（下書き）を出す。
 * R215: 質問の通の一覧が空のボタン・種別「テキスト」だった。
 *   質問文を見出しにし、種別を「質問・分岐」と出す。
 * R213: 2通目以降の編集プレビューが1通目と案内された。
 *   編集中の通番号を StepPreview へ渡す。
 *
 * 直しを戻すと、この試験は赤くなる。
 */

const DETAIL = fs.readFileSync(path.join(__dirname, 'scenario-detail-client.tsx'), 'utf8')

describe('R212: 一覧で下書きの通を見分けられる', () => {
  it('内容欄に下書きの札を出す', () => {
    expect(DETAIL).toContain('step.isDraft === true && <StatusChip status="draft" />')
  })
})

describe('R215: 一覧に質問文と正しい種別が出る', () => {
  it('見出しと種別は共通の関数で出す（質問文・質問・分岐）', () => {
    expect(DETAIL).toContain('stepListTitle(step, tpl?.name ?? null)')
    expect(DETAIL).toContain('stepKindLabel(')
  })
})

describe('R213: 編集プレビューに実際の通番号を渡す', () => {
  it('StepPreview へ編集中の通番号を渡す', () => {
    expect(DETAIL).toContain('stepOrder={stepForm.stepOrder}')
  })
})

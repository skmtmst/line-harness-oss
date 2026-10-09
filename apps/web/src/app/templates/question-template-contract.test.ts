import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(new URL('../../v8/templates/question-new.tsx', import.meta.url), 'utf8')
const templates = readFileSync(new URL('../../v8/templates/list.tsx', import.meta.url), 'utf8')
const scenarios = readFileSync(join(HERE, '..', 'scenarios', 'detail', 'scenario-detail-client.tsx'), 'utf8')
const editor = readFileSync(join(HERE, '..', '..', 'components', 'scenarios', 'question-editor.tsx'), 'utf8')

describe('V8 質問テンプレート', () => {

  it('既存の質問エンジンを再利用し、プレビューと利用先を同じ画面で確認できる', () => {
    expect(page).toContain('<QuestionEditor')
    expect(page).toContain('choiceColumns')
    // B-6: 題「LINEプレビュー」は共通部品が出す。画面側は使うだけ。
    expect(page).toContain('<LinePreview')
    expect(page).toContain('答えをどこに残すか')
    expect(page).toContain('この質問を使う場所')
    expect(editor).toContain("choiceColumns ? 'grid gap-3 xl:grid-cols-2'")
  })

  it('タグは全件を展開せず、閉じた選択欄と選択済みの札だけを表示する', () => {
    // 選び欄は共通 Select（閉じた選択欄）。素の <select> は置かない。
    expect(editor).toContain('<Select')
    expect(editor).not.toContain('<select')
    expect(editor).toContain('aria-label={label}')
    expect(editor).toContain("'タグを選ぶ'")
    expect(editor).toContain('selectedTags.map')
    expect(editor).not.toContain('tags.map((tag) => {')
    expect(editor).toContain('(choiceColumns || openChoice === index)')
    expect(editor).toContain('タグ・記録などの詳しい設定')
  })

  it('下書きは選択肢へ出さず、公開した質問だけをシナリオへ渡す', () => {
    expect(page).toContain("save('draft')")
    expect(page).toContain("save('published')")
    expect(page).toContain('下書き')
    expect(scenarios).toContain("t.questionStatus === 'published'")
    expect(scenarios).toContain('structuredClone(template.question)')
  })
})

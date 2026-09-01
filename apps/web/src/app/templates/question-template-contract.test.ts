import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(HERE, 'questions', 'new', 'page.tsx'), 'utf8')
const templates = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const scenarios = readFileSync(join(HERE, '..', 'scenarios', 'detail', 'scenario-detail-client.tsx'), 'utf8')
const editor = readFileSync(join(HERE, '..', '..', 'components', 'scenarios', 'question-editor.tsx'), 'utf8')

describe('V6 質問テンプレート', () => {
  it('NNDMRを質問専用画面として開き、本文タイトルを重ねない', () => {
    expect(page).toContain('data-design-node="NNDMR"')
    expect(page).toContain("usePageTitle('質問を作る')")
    expect(page).not.toContain('<h1')
    expect(page).not.toContain("import Header from '@/components/layout/header'")
    expect(templates).toContain('href="/templates/questions/new"')
  })

  it('既存の質問エンジンを再利用し、プレビューと利用先を同じ画面で確認できる', () => {
    expect(page).toContain('<QuestionEditor')
    expect(page).toContain('choiceColumns')
    expect(page).toContain('LINEプレビュー')
    expect(page).toContain('答えをどこに残すか')
    expect(page).toContain('この質問を使う場所')
    expect(editor).toContain("choiceColumns ? 'grid gap-3 xl:grid-cols-2'")
  })

  it('下書きは選択肢へ出さず、公開した質問だけをシナリオへ渡す', () => {
    expect(page).toContain("save('draft')")
    expect(page).toContain("save('published')")
    expect(page).toContain('下書きはシナリオの選択肢に出ません。')
    expect(scenarios).toContain("t.questionStatus === 'published'")
    expect(scenarios).toContain('structuredClone(template.question)')
  })
})

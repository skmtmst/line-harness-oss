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

describe('V6 質問テンプレートの寸法', () => {
  it('パネルの角丸と影をV6の値にそろえる', () => {
    // 角丸と影は1系統になった。card=10px、影は `--shadow-card` だけ。
    const panels = page.match(/rounded-card/g) ?? []
    expect(panels.length).toBeGreaterThanOrEqual(5)
    expect(page).toContain('shadow-card')
    expect(page).not.toContain('rounded-lg')
    expect(page).not.toContain('rounded-xl')
  })

  it('入力欄は共通部品（高さ40px・文字13px）を使う', () => {
    expect(page).toContain("import { TextField } from '@/components/shared/text-field'")
    expect(page).toContain('<TextField')
    expect(page).not.toContain('<input')
    expect(page).not.toContain('px-3 py-2 text-sm')
  })

  it('本文の文字サイズを意味名のトークンで指定する', () => {
    expect(page).toContain('text-label')
    expect(page).toContain('text-caption')
  })
})

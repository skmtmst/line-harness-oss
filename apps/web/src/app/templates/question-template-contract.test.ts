import { cloneScenarioQuestion, isSelectableScenarioTemplate } from '../../v8/scenario-detail/question-template-model'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(HERE, '../../v8/templates/question-new.tsx'), 'utf8')
const editor = readFileSync(join(HERE, '..', '..', 'components', 'scenarios', 'question-editor.tsx'), 'utf8')

/*
 * 題・板・使う場所と届き方・「押されたら」の窓・下書きと公開の保存・フォルダは
 * question-template-react.test.tsx、タグの選び方は question-editor-effects-react.test.tsx で、
 * 画面を開いて確かめる。ここに残すのは、戻してはいけない書き方の見張りと、選べる質問の決まり。
 */
describe('V8 質問テンプレート', () => {
  it('採用済みの質問専用画面を開き、本文タイトルを重ねない', () => {
    expect(page).not.toContain('<h1')
    expect(page).not.toContain("import Header from '@/components/layout/header'")
  })

  it('タグは全件を展開せず、閉じた選択欄と選択済みの札だけを表示する', () => {
    expect(editor).not.toContain('<select')
    expect(editor).not.toContain('tags.map((tag) => {')
  })

  it('下書きは選択肢へ出さず、公開した質問だけをシナリオへ渡す', () => {
    const question = { text: '選んでください', tapMode: 'single' as const, choices: [{ key: 'a', label: 'はい', behavior: 'none' as const }] }
    const templates = [
      { id: 'plain', question: null },
      { id: 'ready', question, questionStatus: 'published' },
      { id: 'draft', question, questionStatus: 'draft' },
      { id: 'unknown', question },
    ]
    expect(templates.filter(isSelectableScenarioTemplate).map(template => template.id)).toEqual(['plain', 'ready'])
    const editable = cloneScenarioQuestion(question)
    editable.choices[0].label = '入力した内容'
    expect(question.choices[0].label).toBe('はい')
    expect(editable.choices[0].key).toBe('a')
  })
})

describe('V8 質問テンプレートの共通の値', () => {
  it('入力欄は共通Fieldと採用済みのV8の寸法を使う', () => {
    expect(page).not.toContain('px-3 py-2 text-sm')
  })

  it('本文の文字サイズを意味名のトークンで指定する', () => {
    // 意味名以外の生サイズが戻らないことだけをここで見張る。
    expect(page).not.toMatch(/text-\[\d+(?:\.\d+)?px\]/)
  })
})

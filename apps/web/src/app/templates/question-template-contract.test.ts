import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { cloneScenarioQuestion, isSelectableScenarioTemplate } from '../../v8/scenario-detail/question-template-model'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(HERE, '../../v8/templates/question-new.tsx'), 'utf8')
const templates = readUiSource(join(HERE, '../../v8/templates/list.tsx'), 'utf8')
const css = readFileSync(join(HERE, '../../v8/templates/question-new.module.css'), 'utf8')
const editor = readFileSync(join(HERE, '..', '..', 'components', 'scenarios', 'question-editor.tsx'), 'utf8')

describe('V8 質問テンプレート', () => {
  it('採用済みの質問専用画面を開き、本文タイトルを重ねない', () => {
    expect(page).toContain('boardId="l87p1J"')
    expect(page).toContain("usePageTitle(host ? 'テンプレート' : id ? '質問を編集' : '質問を作る')")
    expect(page).not.toContain('<h1')
    expect(page).not.toContain("import Header from '@/components/layout/header'")
    expect(templates).toContain("href: '/templates/questions/new'")
  })

  it('既存の質問エンジンを再利用し、プレビューと利用先を同じ画面で確認できる', () => {
    expect(page).toContain('<QuestionEditor')
    expect(page).toContain('choiceColumns')
    // : 題「LINEプレビュー」は共通部品が出す。画面側は使うだけ。
    expect(page).toContain('<LinePreview')
    expect(page).toContain('答えをどこに残すか')
    expect(page).toContain('この質問を使う場所')
  })

  it('タグは全件を展開せず、閉じた選択欄と選択済みの札だけを表示する', () => {
    // タグは選ぶ窓（まとめて選ぶ欄）。欄は選んだ件数と名前の1行で、全件は窓の中にだけ並ぶ。素の <select> は置かない。
    expect(editor).toContain('<ActionList<Effect>')
    expect(editor).toContain('multiple')
    expect(editor).not.toContain('<select')
    expect(editor).toContain('<EntityPickerField label="タグ"')
    expect(editor).toContain('item.ids')
    expect(editor).not.toContain('tags.map((tag) => {')
    expect(editor).toContain('(choiceOnly !== undefined || choiceColumns || openChoice === index)')
    expect(editor).toContain('タグ・記録などの詳しい設定')
  })

  it('下書きは選択肢へ出さず、公開した質問だけをシナリオへ渡す', () => {
    expect(page).toContain("save('draft')")
    expect(page).toContain("save('published')")
    expect(page).toContain('下書きを保存')
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
  it('パネルの角丸と影はV8の共通の値を読む', () => {
    expect(page).toContain('<TemplateEditFrame')
    expect(page).toContain('<Card variant="form" gap="normal"')
    const common = readFileSync(join(HERE, '../../components/shared/card.module.css'), 'utf8')
    expect(common).toContain('box-shadow: var(--card-shadow)')
  })

  it('入力欄は共通Fieldと採用済みのV8の寸法を使う', () => {
    expect(page).toContain(`<Field label="質問文（160文字まで）" requirement={fields.requirement('text')}`)
    expect(css).toContain('height: var(--tpl-cn-control-h)')
    expect(css).toContain('font-size: var(--text-body)')
    expect(page).not.toContain('px-3 py-2 text-sm')
  })

  it('本文の文字サイズを意味名のトークンで指定する', () => {
    expect(css).toContain('font-size: var(--text-label)')
    // #976 U086: 「必須」の text-caption 札は共通 RequiredBadge へ寄せたため
    // このファイルから text-caption は消えた。意味名以外の生サイズが戻らない
    // ことだけをここで見張る。
    expect(page).not.toMatch(/text-\[\d+(?:\.\d+)?px\]/)
  })
})

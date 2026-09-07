import { describe, expect, it } from 'vitest'
import { emptyLayout, type FormInputBlock } from '@line-crm/shared'
import { validateLayoutForSave } from './form-validate'

function choiceBlock(label: string, choices: Array<{ id: string; label: string }>): FormInputBlock {
  return {
    id: 'q1',
    kind: 'input',
    type: 'radio',
    name: 'q1',
    label,
    choiceMode: 'tag',
    choices,
  }
}

describe('validateLayoutForSave', () => {
  it('正しい定義は通す', () => {
    const layout = emptyLayout()
    layout.sections[0].blocks = [choiceBlock('プラン', [{ id: 'c1', label: '継続' }])]
    expect(validateLayoutForSave(layout)).toBeNull()
  })

  it('選択肢が無い・空の選択肢を止める', () => {
    const noChoice = emptyLayout()
    noChoice.sections[0].blocks = [choiceBlock('プラン', [])]
    expect(validateLayoutForSave(noChoice)).toContain('選択肢がありません')

    const emptyChoice = emptyLayout()
    emptyChoice.sections[0].blocks = [choiceBlock('プラン', [{ id: 'c1', label: '  ' }])]
    expect(validateLayoutForSave(emptyChoice)).toContain('空の選択肢')
  })

  it('ボタンと回答後ページのURLの形を見る', () => {
    const badButton = emptyLayout()
    badButton.sections[0].blocks = [
      { id: 'b1', kind: 'button', label: '申込む', url: 'example.com/apply' },
    ]
    expect(validateLayoutForSave(badButton)).toContain('URLの形')

    const badThanks = emptyLayout()
    badThanks.options.thanksUrl = 'ftp://example.test/thanks'
    expect(validateLayoutForSave(badThanks)).toContain('開くページ')
  })

  it('期限ありなのに日時が無い・壊れているのを止める', () => {
    const missing = emptyLayout()
    missing.options.deadline = { enabled: true, endsAt: '' }
    expect(validateLayoutForSave(missing)).toContain('期限')

    const broken = emptyLayout()
    broken.options.deadline = { enabled: true, endsAt: 'not-a-date' }
    expect(validateLayoutForSave(broken)).toContain('期限')

    const ok = emptyLayout()
    ok.options.deadline = { enabled: true, endsAt: '2026-12-31T23:59' }
    expect(validateLayoutForSave(ok)).toBeNull()
  })
})

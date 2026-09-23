import { describe, expect, it } from 'vitest'
import { emptyLayout, type FormInputBlock } from '@line-crm/shared'
import { OG_IMAGE_URL_ERROR, ogImageUrlError, validateLayoutForSave } from './form-validate'

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

describe('保存時に止める壊れた定義(FORM-03 / FORM-04 / FORM-12)', () => {
  it('文字数の下限が上限を超える設定を止める', () => {
    const layout = emptyLayout()
    layout.sections[0].blocks = [
      { id: 'q1', kind: 'input', type: 'text', name: 'memo', label: 'ひとこと', limit: { min: 100, max: 10 } },
    ]
    expect(validateLayoutForSave(layout)).toContain('最小文字数が最大文字数を超えています')
  })

  it('選択数の下限が上限を超える設定を止める', () => {
    const layout = emptyLayout()
    layout.sections[0].blocks = [
      {
        id: 'q1', kind: 'input', type: 'checkbox', name: 'fav', label: '好きなもの',
        selectionLimit: { min: 3, max: 1 },
        choices: [
          { id: 'c1', label: '犬' },
          { id: 'c2', label: '猫' },
          { id: 'c3', label: '鳥' },
        ],
      },
    ]
    expect(validateLayoutForSave(layout)).toContain('下限が上限を超えています')
  })

  it('ラジオの初期選択が2つある設定を止める', () => {
    const layout = emptyLayout()
    layout.sections[0].blocks = [
      choiceBlock('プラン', [
        { id: 'c1', label: '松' },
        { id: 'c2', label: '竹' },
      ]),
    ]
    const block = layout.sections[0].blocks[0] as FormInputBlock
    block.choices = block.choices!.map((c) => ({ ...c, defaultSelected: true }))
    expect(validateLayoutForSave(layout)).toContain('はじめから選んでおく')
  })

  it('定員が整数でない選択肢を止める', () => {
    const layout = emptyLayout()
    const block = choiceBlock('希望の回', [{ id: 'c1', label: '午前' }])
    block.choices = [{ ...block.choices![0], capacity: { enabled: true, limit: 2.5 } }]
    layout.sections[0].blocks = [block]
    expect(validateLayoutForSave(layout)).toContain('整数')
  })
})

/*
 * FORM-18 — OGP画像は https のURLだけを受け付ける。
 *
 * 画面には「https:// のURL」と書いてあるのに、http:// で始まるURLが
 * そのまま保存されて残っていた。LINEのOGP取得はhttpsを前提にするので、
 * 入力中・保存の直前の両方で同じ検査を掛ける。
 */
describe('ogImageUrlError（FORM-18）', () => {
  it('空欄は「設定しない」なので通す', () => {
    expect(ogImageUrlError('')).toBe('')
    expect(ogImageUrlError('   ')).toBe('')
    expect(ogImageUrlError(null)).toBe('')
    expect(ogImageUrlError(undefined)).toBe('')
  })

  it('https:// のURLは通す', () => {
    expect(ogImageUrlError('https://example.com/ogp.png')).toBe('')
    expect(ogImageUrlError('  https://cdn.example.co.jp/a.jpg?x=1  ')).toBe('')
  })

  it('http:// や別の書き方は、理由つきで止める', () => {
    expect(ogImageUrlError('http://example.com/ogp.png')).toBe(OG_IMAGE_URL_ERROR)
    expect(ogImageUrlError('example.com/ogp.png')).toBe(OG_IMAGE_URL_ERROR)
    expect(ogImageUrlError('ftp://example.com/x.png')).toBe(OG_IMAGE_URL_ERROR)
  })
})

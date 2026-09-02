import { describe, expect, it } from 'vitest'
import { failedTagRowsCsv, parseTagCsv, TagCsvParseError } from './tag-csv-import'

describe('parseTagCsv', () => {
  it('BOM・見出し・引用符・改行を保って元の行番号を返す', () => {
    expect(parseTagCsv('\uFEFFタグ名,フォルダ\r\n"VIP,特別",会員\r\n"会員\nランク",販売\r\n')).toEqual([
      { line: 2, name: 'VIP,特別', folderName: '会員' },
      { line: 3, name: '会員\nランク', folderName: '販売' },
    ])
  })

  it('500件は通し、501件は画面で止める', () => {
    expect(parseTagCsv(Array.from({ length: 500 }, (_, index) => `タグ${index}`).join('\n'))).toHaveLength(500)
    expect(() => parseTagCsv(Array.from({ length: 501 }, (_, index) => `タグ${index}`).join('\n')))
      .toThrow('一度に確認できるのは500件までです')
  })

  it('UTF-8で読めなかった文字と閉じていない引用符を受け付けない', () => {
    expect(() => parseTagCsv('タグ名\n\uFFFD')).toThrow(TagCsvParseError)
    expect(() => parseTagCsv('タグ名\n"閉じない')).toThrow('引用符が閉じていません')
  })
})

describe('failedTagRowsCsv', () => {
  it('失敗行だけを書き出し、数式で始まる値を実行させない', () => {
    const csv = failedTagRowsCsv([
      { line: 2, name: '=HYPERLINK("x")', folderName: '+危険', status: 'invalid', message: '確認してください' },
      { line: 3, name: '成功', folderName: '', status: 'created' },
      { line: 4, name: '重複', folderName: '', status: 'skipped' },
    ])
    expect(csv).toContain('"\'=HYPERLINK(""x"")"')
    expect(csv).toContain('"\'+危険"')
    expect(csv).not.toContain('成功')
    expect(csv).not.toContain('重複')
  })
})

import type { TagCsvImportInputRow, TagCsvImportRowResult } from '@line-crm/shared'

export const TAG_CSV_MAX_ROWS = 500
export const TAG_CSV_MAX_BYTES = 1024 * 1024

export class TagCsvParseError extends Error {}

type CsvRecord = { line: number; cells: string[] }

/** 引用符・改行・BOMを壊さずにCSVを読む。完全な空行だけは対象外にする。 */
function readCsvRecords(source: string): CsvRecord[] {
  const text = source.replace(/^\uFEFF/, '')
  if (text.includes('\uFFFD')) {
    throw new TagCsvParseError('UTF-8で保存したCSVを選んでください')
  }

  const records: CsvRecord[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let line = 1
  let recordLine = 1

  const finishRecord = () => {
    cells.push(cell)
    if (cells.some((value) => value.trim() !== '')) records.push({ line: recordLine, cells })
    cells = []
    cell = ''
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (character === ',' && !quoted) {
      cells.push(cell)
      cell = ''
      continue
    }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      finishRecord()
      line += 1
      recordLine = line
      continue
    }
    if (character === '\n') line += 1
    cell += character
  }

  if (quoted) throw new TagCsvParseError(`${recordLine}行目の引用符が閉じていません`)
  if (cell || cells.length > 0) finishRecord()
  return records
}

export function parseTagCsv(source: string): TagCsvImportInputRow[] {
  const records = readCsvRecords(source)
  const first = records[0]?.cells[0]?.trim().normalize('NFKC').toLocaleLowerCase('ja-JP')
  const body = first === 'タグ名' || first === 'tag' || first === 'name'
    ? records.slice(1)
    : records
  if (body.length === 0) throw new TagCsvParseError('登録するタグがありません')
  if (body.length > TAG_CSV_MAX_ROWS) {
    throw new TagCsvParseError(`一度に確認できるのは${TAG_CSV_MAX_ROWS}件までです`)
  }
  return body.map((record) => ({
    line: record.line,
    name: record.cells[0] ?? '',
    folderName: record.cells[1] ?? '',
  }))
}

function formulaSafe(value: string): string {
  return /^[\t\r ]*[=+\-@]/u.test(value) ? `'${value}` : value
}

function csvCell(value: string): string {
  return `"${formulaSafe(value).replaceAll('"', '""')}"`
}

/** 入らなかった行だけを、表計算ソフトの数式として実行されないCSVにする。 */
export function failedTagRowsCsv(rows: TagCsvImportRowResult[]): string {
  const failed = rows.filter((row) => row.status === 'invalid' || row.status === 'failed')
  return `\uFEFF${[
    ['タグ名', 'フォルダ', 'エラー理由'],
    ...failed.map((row) => [row.name, row.folderName, row.message ?? '登録できませんでした']),
  ].map((row) => row.map(csvCell).join(',')).join('\r\n')}`
}

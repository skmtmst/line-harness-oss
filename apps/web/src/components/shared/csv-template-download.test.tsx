// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import CsvTemplateDownload, { csvTemplate } from './csv-template-download'
import { parseTagCsv } from '@/components/friend-fields/tag-csv-import'

const TAG_IMPORT_HEADERS = ['タグ名', 'フォルダ'] as const

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('タグ取り込み用の空ひな形を既存のCSV読取で読める', () => {
  expect(parseTagCsv(csvTemplate(TAG_IMPORT_HEADERS))).toEqual([])
  expect(csvTemplate(['列,名', '名"前'])).toBe('\uFEFF"列,名","名""前"\r\n')
})

it('共通の文字ボタンからUTF-8 CSVを保存し、URLを解放する', async () => {
  let content: Blob | undefined
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn((blob: Blob) => { content = blob; return 'blob:template' })
    static revokeObjectURL = vi.fn()
  })
  const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  render(<CsvTemplateDownload headers={TAG_IMPORT_HEADERS} name="タグ" />)
  fireEvent.click(screen.getByRole('button', { name: 'CSVのひな形をダウンロード' }))
  expect(clicked).toHaveBeenCalledOnce()
  expect(content?.type).toBe('text/csv;charset=utf-8')
  expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(await content!.arrayBuffer())).toBe(csvTemplate(TAG_IMPORT_HEADERS))
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:template')
})

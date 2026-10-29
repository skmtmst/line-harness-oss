'use client'

import { Download } from 'lucide-react'
import Button from './button'
import { downloadCsv } from './csv-download'
import { csvFileName } from '@/lib/csv-file-name'

/** 取り込み側の列定義を受け取り、見出しだけの UTF-8 CSV を保存する。 */
export function csvTemplate(headers: readonly string[]): string {
  return `\uFEFF${headers.map((header) => `"${header.replaceAll('"', '""')}"`).join(',')}\r\n`
}

export default function CsvTemplateDownload({ headers, name }: { headers: readonly string[]; name: string }) {
  return <Button variant="text" size="inline" onClick={() => downloadCsv(csvTemplate(headers), csvFileName(`${name}のひな形`))}>
    <Download size={16} aria-hidden="true" />CSVのひな形をダウンロード
  </Button>
}

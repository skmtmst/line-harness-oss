import type { ReactNode } from 'react'
import { TERMS_DOCUMENT, type TermsSection } from '@/content/terms/musubo-terms'

function inlineText(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => (
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={`${index}-${part}`} className="font-bold text-ink">{part.slice(2, -2)}</strong>
      : <span key={`${index}-${part}`}>{part}</span>
  ))
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
}

function SectionBody({ section }: { section: TermsSection }) {
  const lines = section.body.split('\n')
  const content: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }
    if (line.trim().startsWith('|')) {
      const tableLines: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        tableLines.push(lines[index])
        index += 1
      }
      const rows = tableLines
        .filter((item) => !/^\|?[\s:-]+(?:\|[\s:-]+)+\|?$/.test(item.trim()))
        .map(tableCells)
      const [head, ...body] = rows
      content.push(<div key={`table-${index}`} className="my-4 overflow-x-auto rounded-control border border-hairline bg-canvas">
        <table className="w-full min-w-[520px] text-left text-xs leading-6">
          <thead className="bg-canvas-sunken"><tr>{head.map((cell) => <th key={cell} className="border-b border-hairline px-3 py-2 font-bold text-ink">{inlineText(cell)}</th>)}</tr></thead>
          <tbody className="divide-y divide-hairline">{body.map((row, rowIndex) => <tr key={`${rowIndex}-${row.join('|')}`}>{row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`} className="px-3 py-2 align-top text-ink-secondary">{inlineText(cell)}</td>)}</tr>)}</tbody>
        </table>
      </div>)
      continue
    }

    const list = line.match(/^(\s*)(\d+)\.\s(.+)$/)
    if (list) {
      const nested = list[1].length > 0
      content.push(<p key={`${index}-${line}`} className={`${nested ? 'pl-5' : ''} my-2 text-sm leading-7 text-ink-secondary`}>
        <span className="mr-2 font-semibold text-ink">{list[2]}.</span>{inlineText(list[3])}
      </p>)
    } else {
      content.push(<p key={`${index}-${line}`} className="my-2 text-sm leading-7 text-ink-secondary">{inlineText(line)}</p>)
    }
    index += 1
  }
  return <>{content}</>
}

export default function TermsDocumentContent() {
  return <article className="text-ink">
    <h1 className="text-xl font-bold">{TERMS_DOCUMENT.title}</h1>
    <dl className="mt-4 grid gap-1 text-xs leading-6 text-ink-secondary">
      <div className="flex gap-2"><dt className="font-semibold text-ink">文書ID</dt><dd>{TERMS_DOCUMENT.key}</dd></div>
      <div className="flex gap-2"><dt className="font-semibold text-ink">バージョン</dt><dd>{TERMS_DOCUMENT.version}</dd></div>
      <div className="flex gap-2"><dt className="font-semibold text-ink">制定日</dt><dd>{TERMS_DOCUMENT.displayDate}（仮）</dd></div>
      <div className="flex gap-2"><dt className="font-semibold text-ink">提供者</dt><dd>{TERMS_DOCUMENT.provider}</dd></div>
    </dl>
    <div className="mt-6 space-y-7">{TERMS_DOCUMENT.sections.map((section) => <section key={section.heading}>
      <h2 className="border-b border-hairline pb-2 text-base font-bold text-ink">{section.heading}</h2>
      <div className="mt-3"><SectionBody section={section} /></div>
    </section>)}</div>
  </article>
}

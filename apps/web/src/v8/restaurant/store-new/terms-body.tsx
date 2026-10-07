/*
 * ★V8 利用規約の本文（店舗を追加 ①の枠 `ao15G`・利用規約 `VdKOK` で使う）。
 * 中身は今と同じ TERMS_DOCUMENT。表と番号付きの行の読み方は components/legal/terms-document と同じ。
 * 見た目だけ V8 の絵（見出し・本文の大きさ）に合わせる。size="compact" は ①の枠の小さい字。
 */
import type { ReactNode } from 'react'
import { TERMS_DOCUMENT, TERMS_IS_DRAFT, type TermsSection } from '@/content/terms/musubo-terms'
import { Th } from '@/components/shared/table'
import styles from './terms-body.module.css'

function inlineText(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => (
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={`${index}-${part}`} className={styles.strong}>{part.slice(2, -2)}</strong>
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
    if (!line.trim()) { index += 1; continue }
    if (line.trim().startsWith('|')) {
      const tableLines: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('|')) { tableLines.push(lines[index]); index += 1 }
      const rows = tableLines.filter((item) => !/^\|?[\s:-]+(?:\|[\s:-]+)+\|?$/.test(item.trim())).map(tableCells)
      const [head, ...body] = rows
      content.push(
        <table key={`table-${index}`} className={styles.table}>
          <thead><tr>{head.map((cell) => <Th key={cell} className={styles.th}>{inlineText(cell)}</Th>)}</tr></thead>
          <tbody>{body.map((row, rowIndex) => <tr key={`${rowIndex}-${row.join('|')}`}>{row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`} className={styles.td}>{inlineText(cell)}</td>)}</tr>)}</tbody>
        </table>,
      )
      continue
    }
    const list = line.match(/^(\s*)(\d+)\.\s(.+)$/)
    content.push(
      <p key={`${index}-${line}`} className={`${styles.text} ${list && list[1].length > 0 ? styles.nested : ''}`}>
        {list ? <><span className={styles.number}>{`${list[2]}.`}</span>{inlineText(list[3])}</> : inlineText(line)}
      </p>,
    )
    index += 1
  }
  return <>{content}</>
}

export function termsSectionId(index: number): string {
  return `terms-section-${index + 1}`
}

export default function TermsBody({ size = 'regular' }: { size?: 'regular' | 'compact' }) {
  return (
    <div className={`${styles.body} ${size === 'compact' ? styles.compact : ''}`}>
      <p className={styles.meta}>{`${TERMS_DOCUMENT.title}（${TERMS_DOCUMENT.version} / ${TERMS_DOCUMENT.displayDate}）・提供者 ${TERMS_DOCUMENT.provider}`}</p>
      {TERMS_IS_DRAFT ? <p className={styles.draft}>これは開発中の仮の利用規約です。正式版の公開時に、あらためて同意をお願いします。</p> : null}
      {TERMS_DOCUMENT.sections.map((section, index) => (
        <section key={section.heading} id={termsSectionId(index)} className={styles.section} aria-label={section.heading}>
          <h2 className={styles.heading}>{section.heading}</h2>
          <SectionBody section={section} />
        </section>
      ))}
    </div>
  )
}

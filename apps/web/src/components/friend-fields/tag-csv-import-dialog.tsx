'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleCheck, Download, Info, TriangleAlert } from 'lucide-react'
import type {
  TagCsvImportInputRow,
  TagCsvImportPreview,
  TagCsvImportResult,
  TagCsvImportRowResult,
} from '@line-crm/shared'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import { TableHeadRow, Th } from '@/components/shared/table'
import {
  failedTagRowsCsv,
  parseTagCsv,
  TAG_CSV_MAX_BYTES,
  TagCsvParseError,
} from './tag-csv-import'
import styles from './tag-csv-import-dialog.module.css'

type Phase = 'select' | 'preview' | 'saving' | 'success' | 'partial'
type PreviewFilter = 'all' | 'ready' | 'skipped' | 'invalid'

const STATUS_LABEL: Record<TagCsvImportRowResult['status'], string> = {
  ready: '新規',
  created: '登録済み',
  skipped: '見送り',
  invalid: '入力確認',
  failed: '登録失敗',
}

function downloadCsv(content: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

function todayInJapan() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date())
}

export default function TagCsvImportDialog({
  open,
  onClose,
  onCompleted,
}: {
  open: boolean
  onClose: () => void
  onCompleted: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const [phase, setPhase] = useState<Phase>('select')
  const [rows, setRows] = useState<TagCsvImportInputRow[]>([])
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<TagCsvImportPreview | null>(null)
  const [result, setResult] = useState<TagCsvImportResult | null>(null)
  const [filter, setFilter] = useState<PreviewFilter>('all')
  const [error, setError] = useState('')
  const [fileInputKey, setFileInputKey] = useState(0)
  const busy = phase === 'saving'
  const panelRef = useOverlayFocus(open, onClose, busy)

  useEffect(() => setMounted(true), [])

  const visiblePreviewRows = useMemo(() => {
    if (!preview) return []
    if (filter === 'all') return preview.rows
    return preview.rows.filter((row) => row.status === filter)
  }, [filter, preview])

  if (!mounted || !open) return null

  const pickFile = async (file: File | undefined) => {
    setError('')
    setRows([])
    setPreview(null)
    if (!file) return setFileName('')
    setFileName(file.name)
    if (file.size > TAG_CSV_MAX_BYTES) {
      setError('CSVは1MB以下にしてください')
      return
    }
    try {
      setRows(parseTagCsv(await file.text()))
    } catch (reason) {
      setError(reason instanceof TagCsvParseError ? reason.message : 'CSVを読み取れませんでした')
    }
  }

  const resetSelection = () => {
    setPhase('select')
    setRows([])
    setFileName('')
    setPreview(null)
    setResult(null)
    setFilter('all')
    setError('')
    setFileInputKey((current) => current + 1)
  }

  const confirmRows = async () => {
    if (rows.length === 0) return
    setError('')
    try {
      const response = await api.tags.importPreview(rows)
      if (!response.success) throw new Error(response.error)
      setPreview(response.data)
      setPhase('preview')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '取り込む内容を確認できませんでした')
    }
  }

  const saveRows = async () => {
    if (!preview || preview.summary.ready === 0) return
    setPhase('saving')
    setError('')
    try {
      const response = await api.tags.importCsv(rows)
      if (!response.success) throw new Error(response.error)
      setResult(response.data)
      setPhase(response.data.outcome === 'success' ? 'success' : 'partial')
      if (response.data.summary.created > 0) onCompleted()
    } catch (reason) {
      setPhase('preview')
      setError(reason instanceof Error ? reason.message : 'タグを登録できませんでした')
    }
  }

  const close = () => {
    if (!busy) onClose()
  }

  const panelClass = phase === 'preview' || phase === 'saving'
    ? styles.previewPanel
    : phase === 'partial'
      ? styles.partialPanel
      : phase === 'success'
        ? styles.successPanel
        : styles.selectPanel
  const designNode = phase === 'preview' || phase === 'saving'
    ? 'sfTEW'
    : phase === 'success'
      ? 'op1rh'
      : phase === 'partial'
        ? 'QzRsJ'
        : 'H374MR'

  const content = (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close()
    }}>
      <section
        ref={panelRef}
        className={`${styles.panel} ${panelClass}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tag-csv-title"
        aria-busy={busy || undefined}
        data-design-node={designNode}
        tabIndex={-1}
      >
        {phase === 'select' ? <>
          <header className={styles.header}>
            <h2 id="tag-csv-title" className={styles.title}>CSVでタグを一括登録</h2>
            <p className={styles.description}>タグ名とフォルダ名をCSVからまとめて読み込みます。最大500件まで確認できます。</p>
          </header>
          <ol className={styles.steps}>
            <li>1列目に「タグ名」、2列目に「フォルダ名」を入れます。</li>
            <li>先頭行は「タグ名,フォルダ」の見出しにできます。</li>
            <li>確認画面で、新規・見送り・入力確認を確かめてから登録します。</li>
          </ol>
          <label className={styles.fileField}>
            <input
              key={fileInputKey}
              className={styles.fileInput}
              aria-label="登録するCSV"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void pickFile(event.target.files?.[0])}
            />
            <span className={styles.fileButton}>CSVを選ぶ</span>
            <span className={`${styles.muted} ${styles.fileName}`} title={fileName || undefined}>{fileName || 'ファイル未選択'}</span>
            <span className={`${styles.muted} ${styles.fileRule}`}>UTF-8・最大500件</span>
          </label>
          <div className={styles.note}><Info aria-hidden="true" size={18} /><span>フォルダが見つからない行は、確認画面で知らせたうえで未分類として登録します。</span></div>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <div className={styles.actions}>
            <Button type="button" onClick={close}>キャンセル</Button>
            <Button type="button" variant="primary" disabled={rows.length === 0} onClick={() => void confirmRows()}>取り込む内容を確認</Button>
          </div>
        </> : null}

        {phase === 'preview' || phase === 'saving' ? <>
          <header className={styles.header}>
            <h2 id="tag-csv-title" className={styles.title}>取り込む内容の確認</h2>
            {/*
              設計 `sfTEW` は見出しの下に**どのファイルの何行か**を出す。
              確認画面を開いたまま別のCSVを選び直せるので、いま見ている数が
              どのファイルのものか分からないと確かめようがない。
            */}
            <p className={styles.description}>
              {preview ? `${fileName || '選んだCSV'} ／ ${preview.summary.total}行を読み込みました。` : null}
              登録できる行だけを登録します。入力確認の行は、直してからもう一度取り込めます。
            </p>
          </header>
          {preview ? <>
            {/* 設計 `sfTEW` は4枚とも「その数が何なのか」を1行添える。 */}
            <div className={styles.summary}>
              {([
                ['読み込んだ行', preview.summary.total, 'ファイルの行数', undefined],
                ['新しく登録', preview.summary.ready, 'そのまま登録されます', styles.summaryReady],
                ['重複で見送り', preview.summary.skipped, '同じ名前のタグがあります', undefined],
                ['入力確認', preview.summary.invalid, '直すまで登録されません', preview.summary.invalid > 0 ? styles.summaryInvalid : undefined],
              ] as Array<[string, number, string, string | undefined]>).map(([label, value, detail, tone]) => <div className={styles.summaryItem} key={label}>
                <span className={styles.summaryLabel}>{label}</span>
                <strong className={`${styles.summaryValue} ${tone ?? ''}`}>{value}件</strong>
                <span className={styles.summaryDetail}>{detail}</span>
              </div>)}
            </div>
            <div className={styles.filters}>
              {([
                ['all', `すべて ${preview.summary.total}`],
                ['ready', `新規 ${preview.summary.ready}`],
                ['skipped', `見送り ${preview.summary.skipped}`],
                ['invalid', `入力確認 ${preview.summary.invalid}`],
              ] as Array<[PreviewFilter, string]>).map(([key, label]) => <button
                type="button"
                key={key}
                aria-pressed={filter === key}
                className={`${styles.filter} ${filter === key ? styles.filterOn : ''}`}
                onClick={() => setFilter(key)}
              >{label}</button>)}
            </div>
            <div className={styles.tableFrame}>
              <table className={styles.table}>
                <colgroup><col style={{ width: '7%' }} /><col style={{ width: '26%' }} /><col style={{ width: '21%' }} /><col style={{ width: '12%' }} /><col /></colgroup>
                <thead><TableHeadRow><Th>行</Th><Th>タグ名</Th><Th>フォルダ</Th><Th>扱い</Th><Th>理由</Th></TableHeadRow></thead>
                <tbody>{visiblePreviewRows.map((row) => <tr key={`${row.line}-${row.name}`}>
                  <td>{row.line}</td>
                  <td className={styles.truncate} title={row.name}>{row.name || '（空欄）'}</td>
                  <td className={styles.truncate} title={row.folderName}>{row.folderName || '未分類'}</td>
                  <td><span className={`${styles.badge} ${styles[row.status]}`}>{STATUS_LABEL[row.status]}</span></td>
                  <td>{row.message ?? '登録できます'}</td>
                </tr>)}</tbody>
              </table>
            </div>
            {/*
              設計 `sfTEW` の注意帯。**押す前に、押したらどうなるかを言う。**
              とくに「同じ名前のタグは上書きしない」は、CSVでフォルダを
              直そうとして見送られたときに、どこへ行けばよいか分からなくなる。
            */}
            <div className={styles.warnBar}>
              <TriangleAlert aria-hidden="true" size={18} />
              <div>
                <p className={styles.warnTitle}>
                  {preview.summary.invalid > 0
                    ? `入力確認の${preview.summary.invalid}行は登録されません`
                    : '登録できる行だけを登録します'}
                </p>
                <p className={styles.warnBody}>
                  通る{preview.summary.ready}行はそのまま登録します。
                  同じ名前のタグは上書きしません。フォルダを変えたいときは、タグ一覧から編集してください。
                </p>
              </div>
            </div>
          </> : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <div className={styles.footerRow}>
            <p className={styles.muted}>入力確認があっても、登録できる行だけ先に登録できます。</p>
            <div className={styles.actions}>
              <Button type="button" disabled={busy} onClick={resetSelection}>CSVを選び直す</Button>
              <Button type="button" variant="primary" disabled={busy || !preview || preview.summary.ready === 0} onClick={() => void saveRows()}>
                {busy ? '登録中…' : `登録できる${preview?.summary.ready ?? 0}件を登録`}
              </Button>
            </div>
          </div>
        </> : null}

        {phase === 'success' && result ? <>
          <div className={styles.resultHead}>
            <span className={styles.resultIcon}><CircleCheck aria-hidden="true" size={26} /></span>
            <header className={styles.header}>
              <h2 id="tag-csv-title" className={styles.title}>{result.summary.created}件を登録しました</h2>
              <p className={styles.description}>タグ一覧へ反映しました。</p>
            </header>
          </div>
          <div className={styles.breakdown}>
            {Object.entries(result.rows.filter((row) => row.status === 'created').reduce<Record<string, number>>((counts, row) => {
              const key = row.folderName || '未分類'
              counts[key] = (counts[key] ?? 0) + 1
              return counts
            }, {})).map(([name, count]) => <span key={name}>{name}：<strong>{count}件</strong></span>)}
            {result.summary.skipped > 0 ? <span>重複で見送り：<strong>{result.summary.skipped}件</strong></span> : null}
          </div>
          <div className={styles.actions}><Button type="button" variant="primary" onClick={close}>タグ一覧へ戻る</Button></div>
        </> : null}

        {phase === 'partial' && result ? <>
          <div className={styles.resultHead}>
            <span className={`${styles.resultIcon} ${styles.warningIcon}`}><TriangleAlert aria-hidden="true" size={26} /></span>
            <header className={styles.header}>
              <h2 id="tag-csv-title" className={styles.title}>
                {result.summary.created > 0
                  ? `${result.summary.created}件を登録し、${result.summary.invalid + result.summary.failed}件は入りませんでした`
                  : 'タグを登録できませんでした'}
              </h2>
              <p className={styles.description}>入らなかった行をCSVで出し、内容を直してもう一度取り込めます。</p>
            </header>
          </div>
          <div className={styles.tableFrame}>
            <table className={styles.table}>
              <colgroup><col style={{ width: '9%' }} /><col style={{ width: '28%' }} /><col style={{ width: '23%' }} /><col /></colgroup>
              <thead><TableHeadRow><Th>行</Th><Th>タグ名</Th><Th>フォルダ</Th><Th>入らなかった理由</Th></TableHeadRow></thead>
              <tbody>{result.rows.filter((row) => row.status === 'invalid' || row.status === 'failed').map((row) => <tr key={`${row.line}-${row.name}`}>
                <td>{row.line}</td><td className={styles.truncate} title={row.name}>{row.name || '（空欄）'}</td>
                <td className={styles.truncate} title={row.folderName}>{row.folderName || '未分類'}</td><td>{row.message}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {result.summary.skipped > 0 ? <p className={styles.muted}>重複していた{result.summary.skipped}件は登録を見送りました。</p> : null}
          <div className={styles.actions}>
            <Button className={styles.exportButton} type="button" onClick={() => downloadCsv(failedTagRowsCsv(result.rows), `タグ一括登録-要修正-${todayInJapan()}.csv`)}>
              <Download aria-hidden="true" size={16} /> 入らなかった{result.summary.invalid + result.summary.failed}件をCSVで出す
            </Button>
            <Button type="button" variant="primary" onClick={close}>タグ一覧へ戻る</Button>
          </div>
        </> : null}
      </section>
    </div>
  )

  return createPortal(content, document.body)
}

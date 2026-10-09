'use client'

/*
 * ★V8 流入と計測の QR コードの小窓（Pencil `GtI4Y`）。
 * 題「〇〇 の QR コード」→ QR → URL とコピー → 印刷の注 → 「印刷用 PDF」「PNG を保存」（真ん中）。
 *
 * 動きは今の小窓（app/inflow-links/referral-qr-modal.tsx）と同じ：
 * - 停止中も QR・URL・保存を残し、「停止中」と知らせる
 * - 印刷用 PDF はサーバーで作る（`api.entryRoutes.qrPdf`）。ID の無い未登録 ref では出さない
 * - PNG は `/api/qr?size=320x320&data=<URL>&download=1`
 */
import { useState } from 'react'
import { Copy, Download, FileText } from 'lucide-react'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'
import { Field } from '@/components/shared/form-controls'
import StatusBadge from '@/components/shared/status-badge'
import styles from './qr-dialog.module.css'

const WORKER_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

export const referralUrl = (refCode: string) => `${WORKER_BASE.replace(/\/$/, '')}/r/${encodeURIComponent(refCode)}`

export interface QrRoute {
  refCode: string
  name: string
  genre: string | null
  /** false（停止中）のときも QR を保存できる。null は未登録 ref（有効・無効の概念が無い）。 */
  isActive: boolean | null
  /** entry_routes の ID。あるときだけ印刷用 PDF を出せる。 */
  id?: string
  couponEnabled?: boolean
}

export default function QrDialog({ route, onClose }: { route: QrRoute; onClose: () => void }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [pdfState, setPdfState] = useState<'idle' | 'working' | 'failed'>('idle')
  const [format, setFormat] = useState<'png' | 'svg'>('png')
  const [size, setSize] = useState<'small' | 'medium' | 'large'>('medium')
  const [paper, setPaper] = useState<'A4' | 'A5'>('A4')
  const [imageState, setImageState] = useState<'idle' | 'working' | 'failed'>('idle')
  const stopped = route.isActive === false
  const url = referralUrl(route.refCode)
  const qrBase = `${WORKER_BASE.replace(/\/$/, '')}/api/qr?size=320x320&data=${encodeURIComponent(url)}`
  const downloadUrl = `${qrBase}&download=1&filename=${encodeURIComponent(`referral-${route.refCode}`)}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopyState('copied')
    } catch {
      // 失敗に気づかず URL 未コピーのまま配布作業が進むのを防ぐ。
      setCopyState('failed')
    }
    setTimeout(() => setCopyState('idle'), 1500)
  }

  const downloadPdf = async () => {
    if (!route.id) return
    setPdfState('working')
    try {
      const blob = await (route.couponEnabled ? api.entryRoutes.qrPdf(route.id, paper) : api.entryRoutes.qrPdf(route.id))
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `qr-${route.refCode}-${paper}.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
      setPdfState('idle')
    } catch {
      setPdfState('failed')
    }
  }

  const downloadImage = async () => {
    if (!route.id) return
    setImageState('working')
    try {
      const blob = await api.entryRoutes.qrImage(route.id, format, size)
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl; anchor.download = `qr-${route.refCode}-${size}.${format}`
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(objectUrl)
      setImageState('idle')
    } catch { setImageState('failed') }
  }

  return (
    <Dialog
      open
      title={`${route.name} の QR コード`}
      onCancel={onClose}
      designNode="GtI4Y"
      designWidth={480}
      // 絵 GtI4Y：題の下から本文まで14。今の共通の頭（上20・下8）だと本文が7下がるので、頭を57に詰める（題の位置は今のまま）
      designHeaderPadding="20px 24px 0"
      designHeaderHeight={57}
      footer={(
        <div className={styles.actions}>
          {route.id ? (
            <Button
              variant="secondary"
              onClick={() => void downloadPdf()}
              disabled={stopped || imageState === 'working'}
              busy={pdfState === 'working'}
              busyLabel="作っています…"
            >
              <FileText size={15} aria-hidden="true" />{route.couponEnabled ? `紙の見本（${paper}）を保存` : '印刷用 PDF'}
            </Button>
          ) : null}
          {route.id && route.couponEnabled ? <Button variant="primary" disabled={stopped || pdfState === 'working'} busy={imageState === 'working'} onClick={() => void downloadImage()}>
            <Download size={15} aria-hidden="true" />{`${format.toUpperCase()} を保存`}
          </Button> : <Button variant="primary" href={downloadUrl} download={`referral-${route.refCode}.png`}>
            <Download size={15} aria-hidden="true" />PNG を保存
          </Button>}
        </div>
      )}
    >
      {stopped ? <p role="status" className={styles.stopped}>停止中</p> : null}
        <div className={styles.body}>
          {route.couponEnabled ? <StatusBadge tone="warning" dot={false}>クーポン付き</StatusBadge> : null}
          <div className={styles.qrWrap}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Worker が作る QR コード */}
            <img src={qrBase} alt={`${route.name}のQRコード`} className={styles.qr} />
          </div>
          <div className={styles.urlRow}>
            <span className={styles.url} title={url}>{url}</span>
            <Button variant="text" onClick={() => void copy()} aria-label={`${route.name}のURLをコピー`}>
              <Copy size={15} aria-hidden="true" />
              {copyState === 'copied' ? 'コピーしました' : copyState === 'failed' ? 'コピー失敗' : 'コピー'}
            </Button>
          </div>
          {route.id && route.couponEnabled ? <>
            <Field label="形式"><Select aria-label="QRの形式" value={format} onChange={(next) => setFormat(next as 'png' | 'svg')} options={[{ value: 'png', label: 'PNG' }, { value: 'svg', label: 'SVG' }]} /></Field>
            <Field label="大きさ"><Select aria-label="QRの大きさ" value={size} onChange={(next) => setSize(next as 'small' | 'medium' | 'large')} options={[{ value: 'small', label: '小 256' }, { value: 'medium', label: '中 512' }, { value: 'large', label: '大 1024' }]} /></Field>
            <Field label="紙の見本"><Select aria-label="紙の大きさ" value={paper} onChange={(next) => setPaper(next as 'A4' | 'A5')} options={[{ value: 'A4', label: 'A4' }, { value: 'A5', label: 'A5' }]} /></Field>
          </> : null}
          <p className={styles.note}>
            印刷するときは「印刷用 PDF」がきれいです。チラシ・POP では 3cm 以上の大きさにしてください。
          </p>
          {imageState === 'failed' ? <p role="alert" className={styles.error}>QRを保存できませんでした。時間をおいて、もう一度お試しください。</p> : null}
          {pdfState === 'failed' ? (
            <p role="alert" className={styles.error}>印刷用 PDF を作れませんでした。時間をおいて、もう一度お試しください。</p>
          ) : null}
        </div>
    </Dialog>
  )
}

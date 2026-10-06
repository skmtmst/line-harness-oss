'use client'

/*
 * ★V8 流入と計測の QR コードの小窓（Pencil `GtI4Y`）。
 * 題「〇〇 の QR コード」→ QR → URL とコピー → 印刷の注 → 「印刷用 PDF」「PNG を保存」（真ん中）。
 *
 * 動きは今の小窓（app/inflow-links/referral-qr-modal.tsx）と同じ：
 * - 停止中の経路は QR・URL・保存を出さず、選び直しの案内だけ（読み取っても友だち追加できない QR を配らない）
 * - 印刷用 PDF はサーバーで作る（`api.entryRoutes.qrPdf`）。ID の無い未登録 ref では出さない
 * - PNG は `/api/qr?size=320x320&data=<URL>&download=1`
 */
import { useState } from 'react'
import { Copy, Download, FileText } from 'lucide-react'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import styles from './qr-dialog.module.css'

const WORKER_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

export const referralUrl = (refCode: string) => `${WORKER_BASE.replace(/\/$/, '')}/r/${encodeURIComponent(refCode)}`

export interface QrRoute {
  refCode: string
  name: string
  genre: string | null
  /** false（停止中）のときは QR を出さない。null は未登録 ref（有効・無効の概念が無い）。 */
  isActive: boolean | null
  /** entry_routes の ID。あるときだけ印刷用 PDF を出せる。 */
  id?: string
}

export default function QrDialog({ route, onClose }: { route: QrRoute; onClose: () => void }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [pdfState, setPdfState] = useState<'idle' | 'working' | 'failed'>('idle')
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
    if (!route.id || stopped) return
    setPdfState('working')
    try {
      const blob = await api.entryRoutes.qrPdf(route.id)
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `qr-${route.refCode}.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
      setPdfState('idle')
    } catch {
      setPdfState('failed')
    }
  }

  return (
    <Dialog
      open
      title={`${route.name} の QR コード`}
      onCancel={onClose}
      designNode="GtI4Y"
      footer={stopped ? undefined : (
        <div className={styles.actions}>
          {route.id ? (
            <Button
              variant="secondary"
              onClick={() => void downloadPdf()}
              busy={pdfState === 'working'}
              busyLabel="作っています…"
            >
              <FileText size={15} aria-hidden="true" />印刷用 PDF
            </Button>
          ) : null}
          <Button variant="primary" href={downloadUrl} download={`referral-${route.refCode}.png`}>
            <Download size={15} aria-hidden="true" />PNG を保存
          </Button>
        </div>
      )}
    >
      {stopped ? (
        <p role="alert" className={styles.stopped}>
          この経路は停止中のため、QRコードは表示できません。読み取っても友だち追加できないQRを配らないよう、出す口自体を止めています。有効な経路を選び直してください。
        </p>
      ) : (
        <div className={styles.body}>
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
          <p className={styles.note}>
            印刷するときは「印刷用 PDF」がきれいです。チラシ・POP では 3cm 以上の大きさにしてください。
          </p>
          {pdfState === 'failed' ? (
            <p role="alert" className={styles.error}>印刷用 PDF を作れませんでした。時間をおいて、もう一度お試しください。</p>
          ) : null}
        </div>
      )}
    </Dialog>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { Copy, Download } from 'lucide-react'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import { TextField } from '@/components/shared/text-field'
import './referral-qr-v8.css'

const WORKER_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')

export interface ReferralQrRoute {
  /** 未登録の紹介コードには経路IDがない。印刷用PDFは登録済みの経路だけ。 */
  id?: string | null
  refCode: string
  name: string
  genre: string | null
  isActive: boolean | null
}

/** 板 GtI4Y。停止した経路はコードの取得・コピー・保存をすべて止める。 */
export default function ReferralQrModal({ route, onClose }: {
  route: ReferralQrRoute
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [imageAttempt, setImageAttempt] = useState(0)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState('')
  const [canPrint, setCanPrint] = useState(false)
  const generationRef = useRef(0)
  const stopped = route.isActive === false
  const url = `${WORKER_BASE}/r/${encodeURIComponent(route.refCode)}`
  const qrBase = `${WORKER_BASE}/api/qr?size=320x320&data=${encodeURIComponent(url)}`
  const downloadUrl = `${qrBase}&download=1&filename=${encodeURIComponent(`referral-${route.refCode}`)}`

  useEffect(() => {
    const generation = ++generationRef.current
    setCopied(false)
    setCopyFailed(false)
    setImageFailed(false)
    setImageAttempt(0)
    setPdfBusy(false)
    setPdfError('')
    setCanPrint(false)
    if (route.id && !stopped) {
      void api.staff.me().then((result) => {
        if (generationRef.current !== generation || !result.success) return
        const staff = result.data
        setCanPrint(staff.role === 'owner' || staff.role === 'admin'
          || (staff.role === 'staff' && !!staff.permissionKeys?.includes('/inflow-links')))
      }).catch(() => { /* 確かめられなかった権限では印刷APIを呼ばない。 */ })
    }
    return () => { generationRef.current = generation + 1 }
  }, [route.id, route.refCode, stopped])

  const copy = async () => {
    if (stopped) return
    const generation = generationRef.current
    setCopied(false)
    try {
      await navigator.clipboard.writeText(url)
      if (generationRef.current !== generation) return
      setCopied(true)
      setCopyFailed(false)
    } catch {
      if (generationRef.current === generation) setCopyFailed(true)
    }
  }

  const downloadPdf = async () => {
    if (!route.id || stopped || !canPrint || pdfBusy) return
    const generation = generationRef.current
    setPdfBusy(true)
    setPdfError('')
    try {
      const blob = await api.entryRoutes.qrPdf(route.id)
      if (generationRef.current !== generation) return
      const objectUrl = URL.createObjectURL(blob)
      try {
        const anchor = document.createElement('a')
        anchor.href = objectUrl
        anchor.download = `qr-${route.refCode}.pdf`
        anchor.click()
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    } catch {
      if (generationRef.current === generation) {
        setPdfError('印刷用PDFを作れませんでした。もう一度「印刷用PDF」を押してください。')
      }
    } finally {
      if (generationRef.current === generation) setPdfBusy(false)
    }
  }

  return (
    <Dialog open title={`${route.name} の QR コード`} onCancel={onClose} designNode="GtI4Y" busy={pdfBusy}>
      <div className="inflowQrContent">
        {stopped ? (
          <p role="alert" className="text-sm text-ink-secondary">
            この経路は停止中のため、QRコードは表示できません。有効な経路を選び直してください。
          </p>
        ) : (
          <>
            <div className="inflowQrQr">
              {imageFailed ? (
                <div role="alert" className="inflowQrImageFailure">
                  <p>QRコードを読み込めませんでした。</p>
                  <Button onClick={() => { setImageFailed(false); setImageAttempt((value) => value + 1) }}>もう一度読み込む</Button>
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- Workerが生成する経路ごとのQR
                <img key={imageAttempt} src={`${qrBase}${imageAttempt ? `&retry=${imageAttempt}` : ''}`} alt={`${route.name}のQRコード`} width={220} height={220} onError={() => setImageFailed(true)} />
              )}
            </div>
            <div className="inflowQrUrlRow">
              <span className="inflowQrUrl" title={url}>{url}</span>
              <Button variant="secondary" aria-label="URLをコピー" done={copied} doneLabel="コピーしました" onClick={() => void copy()}>
                <Copy size={15} aria-hidden="true" />コピー
              </Button>
            </div>
            {copyFailed ? (
              <div className="inflowQrFallback">
                <p role="alert">コピーできませんでした。下のURLを選んでコピーしてください。</p>
                <TextField aria-label="コピーするURL" value={url} readOnly onFocus={(event) => event.currentTarget.select()} />
              </div>
            ) : null}
            <p className="inflowQrPrintNote">チラシ・POPでは、QRコードを3cm以上の大きさにして印刷してください。</p>
            {pdfError ? <p role="alert" className="text-xs text-ink-secondary">{pdfError}</p> : null}
            <div className="inflowQrActions">
              {canPrint ? <Button variant="secondary" busy={pdfBusy} busyLabel="PDFを作っています…" onClick={() => void downloadPdf()}><Download size={15} aria-hidden="true" />印刷用PDF</Button> : null}
              <Button variant="primary" href={downloadUrl} download={`referral-${route.refCode}.png`}><Download size={15} aria-hidden="true" />PNGを保存</Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}

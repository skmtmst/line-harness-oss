'use client'

import { useState } from 'react'
import Button from '@/components/shared/button'

const WORKER_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

const referralUrl = (refCode: string) => `${WORKER_BASE.replace(/\/$/, '')}/r/${encodeURIComponent(refCode)}`

export interface ReferralQrRoute {
  refCode: string
  name: string
  genre: string | null
  /**
   * 経路が有効かどうか。`false`（停止中）のときは QR を出さない。
   * `null` は未登録 ref など有効・無効の概念が無い行で、従来どおり出す。
   */
  isActive: boolean | null
}

/**
 * 流入経路の QR コード表示。
 *
 * 停止中の経路の QR を配ると、読み取っても友だち追加できない（worker の
 * 解決は `is_active = 1` のみ拾う）。停止中は QR・コピー・ダウンロードを
 * 出さず、選び直しの案内だけを出す。
 */
export default function ReferralQrModal({
  route,
  onClose,
}: {
  route: ReferralQrRoute
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const stopped = route.isActive === false
  const url = referralUrl(route.refCode)
  const qrBase = `${WORKER_BASE.replace(/\/$/, '')}/api/qr?size=320x320&data=${encodeURIComponent(url)}`
  const downloadUrl = `${qrBase}&download=1&filename=${encodeURIComponent(`referral-${route.refCode}`)}`
  const copy = async () => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4">
      <div className="w-full max-w-md rounded-2xl bg-canvas p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-ink-faint">リファラルリンク・QRコード</p>
            <h2 className="mt-1 text-lg font-bold text-ink">{route.name}</h2>
            <p className="mt-1 text-sm text-ink-faint">{route.genre ?? '未分類'}</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-ink-faint" aria-label="閉じる">×</button>
        </div>
        {stopped ? (
          <p role="alert" className="mt-5 rounded-xl bg-canvas-sunken p-4 text-sm leading-relaxed text-ink-secondary">
            この経路は停止中のため、QRコードは表示できません。読み取っても友だち追加できないQRを配らないよう、出す口自体を止めています。有効な経路を選び直してください。
          </p>
        ) : (
          <>
            <div className="mt-5 rounded-xl bg-canvas-sunken p-3">
              <p className="break-all font-mono text-xs text-ink-secondary">{url}</p>
              <Button variant="secondary" onClick={copy} className="mt-3 w-full">
                {copied ? 'コピーしました' : 'URLをコピー'}
              </Button>
            </div>
            <div className="mt-5 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- Workerが動的生成するQRコード */}
              <img src={qrBase} alt={`${route.name}のQRコード`} className="mx-auto h-64 w-64 rounded-xl border border-hairline bg-canvas p-2" />
              <Button variant="primary" href={downloadUrl} download={`referral-${route.refCode}.png`} className="mt-4 w-full">
                QRコードをダウンロード
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

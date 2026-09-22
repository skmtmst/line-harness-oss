'use client'

import { useEffect, useState } from 'react'
import { api, type HqLineRegistration } from '@/lib/api'
import { qrToDataURL } from '@/lib/qr-image'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'

/**
 * 契約者専用LINEの登録案内（★V6 33-2-現状5-B、ダイアログ GiwgF。決定 2026-09-18）。
 * 統括が LINE アカウントの登録（手順 5）を終えた直後に出す。案内だけで、ログインは止めない。
 * QR は友だち追加 URL を画面で描く。追加後に 6 桁の確認コードを LINE で送ると本人と紐づく。
 */
export default function NoticeLineRegisterDialog({ open, onClose, quietWhenUnavailable = true }: {
  open: boolean
  onClose: () => void
  /** 運営側で契約者専用LINEが未設定のとき、何も出さずに閉じる（登録直後の自動表示用）。手動で開いた場合は false にして案内を出す */
  quietWhenUnavailable?: boolean
}) {
  const [info, setInfo] = useState<HqLineRegistration | null>(null)
  const [qr, setQr] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void api.hqNotices.lineRegistration().then(async (res) => {
      if (cancelled || !res.success) return
      setInfo(res.data)
      if (res.data.available && res.data.addFriendUrl) {
        try {
          setQr(await qrToDataURL(res.data.addFriendUrl, { width: 220, margin: 1 }))
        } catch {
          setQr('')
        }
      }
    }).catch(() => { if (!cancelled) setInfo({ available: false }) })
    return () => { cancelled = true }
  }, [open])

  // 運営側で契約者専用LINEが未設定なら、自動表示のときは何も出さずに閉じる
  const unavailable = Boolean(info && !info.available)
  useEffect(() => {
    if (open && unavailable && quietWhenUnavailable) onClose()
  }, [open, unavailable, quietWhenUnavailable, onClose])

  if (!open || (unavailable && quietWhenUnavailable)) return null

  return (
    <Dialog
      open={open}
      title="musubo 運営（契約者専用）の LINE を登録してください"
      description="今後の大事なお知らせ（メンテナンス、料金、重要な変更）はこの LINE に届きます。メールを見逃しても気づけるよう、必ず登録をお願いします。"
      onCancel={onClose}
      footer={<div className="flex justify-end"><Button variant="primary" onClick={onClose}>あとで確認する</Button></div>}
      designNode="GiwgF"
    >
      {!info ? (
        <p className="text-caption text-ink-faint">読み込んでいます…</p>
      ) : info.available ? (
        <div className="flex flex-wrap items-start gap-5">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element -- 手元で描いた data: URL の QR。最適化の対象ではない
            <img src={qr} alt={`${info.accountName} の友だち追加 QR コード`} className="h-44 w-44 rounded-control border border-hairline" />
          ) : null}
          <div className="grid min-w-0 flex-1 gap-2 text-caption text-ink">
            <p className="text-label font-bold">{info.accountName}{info.basicId ? `（${info.basicId}）` : ''}</p>
            <ol className="grid list-decimal gap-1 pl-5">
              <li>スマートフォンの LINE でこの QR を読み取るか、下のボタンから友だち追加します。</li>
              <li>追加できたら、LINE のトーク画面で次の 6 桁を送ってください（あなたの管理画面と紐づきます）。</li>
            </ol>
            {info.linked ? (
              <p className="text-accent-deep">この管理画面はすでに登録済みです。</p>
            ) : info.code ? (
              <p className="text-body font-bold tracking-widest text-ink" aria-label="確認コード">{info.code}</p>
            ) : null}
            {info.addFriendUrl ? (
              <a href={info.addFriendUrl} target="_blank" rel="noreferrer" className="text-accent-deep underline-offset-2 hover:underline">スマートフォンで開く（友だち追加）</a>
            ) : null}
            <p className="text-micro text-ink-faint">確認コードは 24 時間有効です。管理画面の「お問い合わせ」からも、いつでもこの案内を開けます。</p>
          </div>
        </div>
      ) : (
        <p className="text-caption text-ink-faint">契約者専用LINEはまだ運営側で設定されていません。設定できしだい、この画面からご案内します。</p>
      )}
    </Dialog>
  )
}

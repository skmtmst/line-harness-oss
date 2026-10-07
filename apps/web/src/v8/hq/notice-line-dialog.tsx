'use client'

/*
 * ★V8 運営（契約者専用）の LINE を登録する窓（Pencil `D6fh3`）。
 * 読む口・閉じ方は `components/hq/notice-line-register-dialog.tsx` と同じ。
 * 見た目だけを絵どおりに組んだ：QR の箱と説明・6 桁を1字ずつの箱・下の真ん中に「あとで確認する」。
 */
import { useEffect, useState } from 'react'
import { Smartphone } from 'lucide-react'
import { api, type HqLineRegistration } from '@/lib/api'
import { qrToDataURL } from '@/lib/qr-image'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import styles from './notice-line-dialog.module.css'
import head from './dialog-head.module.css'

/** 絵の窓の幅と上からの位置（px）。 */
const DESIGN_WIDTH = 560
const DESIGN_TOP = 150

export default function NoticeLineDialogV8({ open, onClose }: { open: boolean; onClose: () => void }) {
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

  if (!open) return null

  return (
    <Dialog
      open={open}
      title="musubo 運営（契約者専用）の LINE を登録してください"
      description="返信やお知らせを LINE でも受け取れます。"
      designWidth={DESIGN_WIDTH}
      designTop={DESIGN_TOP}
      onCancel={onClose}
      footer={<div className={`${head.footer} ${head.footerCenter}`}><Button onClick={onClose}>あとで確認する</Button></div>}
      designNode="D6fh3"
    >
      <div className={head.head}>
        {!info ? (
          <p className={styles.faint}>読み込んでいます…</p>
        ) : info.available ? (
          <>
            <div className={styles.qrRow}>
              <div className={styles.qrBox}>
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 手元で描いた data: URL の QR。最適化の対象ではない
                  <img src={qr} alt={`${info.accountName} の友だち追加 QR コード`} className={styles.qr} />
                ) : null}
              </div>
              <div className={styles.qrText}>
                <p className={styles.lead}>スマートフォンの LINE でこの QR を読み取るか、下のボタンから友だち追加します。</p>
                {info.addFriendUrl ? (
                  <Button href={info.addFriendUrl} target="_blank" rel="noreferrer">
                    <Smartphone aria-hidden="true" className={styles.icon} />スマートフォンで開く（友だち追加）
                  </Button>
                ) : null}
              </div>
            </div>
            <div className={styles.codePanel}>
              <p className={styles.codeLead}>追加できたら、LINE のトーク画面で次の 6 桁を送ってください（あなたの管理画面と紐づきます）。</p>
              {info.linked ? (
                <p className={styles.linked}>この管理画面はすでに登録済みです。</p>
              ) : info.code ? (
                <p className={styles.digits} aria-label={`確認コード ${info.code}`}>
                  {info.code.split('').map((digit, index) => <span key={index} className={styles.digit} aria-hidden="true">{digit}</span>)}
                </p>
              ) : null}
              <p className={styles.note}>確認コードは 24 時間有効です。管理画面の「お問い合わせ」からも、いつでもこの案内を開けます。</p>
            </div>
          </>
        ) : (
          <p className={styles.faint}>契約者専用LINEはまだ運営側で設定されていません。設定できしだい、この画面からご案内します。</p>
        )}
      </div>
    </Dialog>
  )
}

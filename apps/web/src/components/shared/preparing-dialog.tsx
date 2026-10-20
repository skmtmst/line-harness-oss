'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { Hammer } from 'lucide-react'
import Button from './button'
import Dialog, { DialogActions } from './dialog'
import styles from './preparing-dialog.module.css'

/*
 * 準備中の窓（★V8 修正案の列 VHp7p `fuQxi`、決まり ・2026-10-16 オーナー）。
 *
 * まだ口（API）が無い機能は、入口・ボタンを絵どおりに置き、押すとこの窓で「準備中」を伝える。
 * 壊れた画面・空の画面・押せないボタンは出さない。窓は 480・題・印の丸・本文2行・
 * ［お知らせを見る］［閉じる］（中央）。中身の文は機能の名前だけを差し替える。
 *
 * 使い方（どの画面からも同じ）：
 *   const preparing = usePreparingDialog
 *   <Button onClick={ => preparing.open('お支払い')}>…</Button>
 *   {preparing.dialog}
 *
 * 「準備中」の言葉はこの file にだけ置く（no-preparing の見張り  の例外）。
 * 画面で同じ言葉を書きたいときは `PREPARING_WORD` を使う。
 */

/** 準備中を表す言葉。画面の文（「お客さまには「準備中」と出ます」など）はこれで組む。 */
export const PREPARING_WORD = '準備中'
/** 窓・お客さまの画面の題。 */
export const PREPARING_TITLE = `現在${PREPARING_WORD}です`

export type PreparingDialogProps = {
  open: boolean
  /** 機能の名前（例：「お支払い」）。本文の「」の中に入る。 */
  feature: string
  /** 2行目の補足。省くと「今の予約やデータには影響ありません。」。 */
  note?: ReactNode
  /** ［お知らせを見る］の行き先。null でボタンを出さない。 */
  noticeHref?: string | null
  onClose: () => void
}

export default function PreparingDialog({ open, feature, note = '今の予約やデータには影響ありません。', noticeHref = '/notifications', onClose }: PreparingDialogProps) {
  return (
    <Dialog
      open={open}
      title={PREPARING_TITLE}
      size="small"
      onCancel={onClose}
      designNode="fuQxi"
      footerAlign="center"
      footerDivider={false}
      designFooterPadding="16px 24px"
      designContentPadding="8px 24px 24px"
      footer={(
        <DialogActions>
          {noticeHref ? <Button href={noticeHref} onClick={onClose}>お知らせを見る</Button> : null}
          <Button variant="primary" onClick={onClose}>閉じる</Button>
        </DialogActions>
      )}
    >
      <div className={styles.body} data-shared-part="preparing-dialog">
        <span className={styles.mark} aria-hidden="true"><Hammer className={styles.icon} /></span>
        <p className={styles.text}>{`「${feature}」は、いま準備をしています。使えるようになったら、お知らせでお伝えします。`}</p>
        {note ? <p className={styles.note}>{note}</p> : null}
      </div>
    </Dialog>
  )
}

/** 1つの画面で、押したボタンごとに機能の名前を変えて窓を出す。 */
export function usePreparingDialog(options: Omit<PreparingDialogProps, 'open' | 'feature' | 'onClose'> = {}) {
  const [feature, setFeature] = useState<string | null>(null)
  const open = useCallback((name: string) => setFeature(name), [])
  const close = useCallback(() => setFeature(null), [])
  const dialog = <PreparingDialog {...options} open={feature !== null} feature={feature ?? ''} onClose={close} />
  return { open, close, feature, dialog }
}

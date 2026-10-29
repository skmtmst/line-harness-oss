'use client'

import { useEffect, useState } from 'react'
import type { AccountStyle } from '@line-crm/shared'
import { ArrowRight, Info } from 'lucide-react'
import Button from '@/components/shared/button'
import Dialog, { DialogActions } from '@/components/shared/dialog'
import HelpTip from '@/components/shared/help-tip'
import { ProgressBar } from '@/components/shared/progress'
import { StyleChoiceStep, STYLE_CHOICE_START_ID, StyleChoiceStatus } from '@/v8/onboarding/public/style-choice'
import styles from '@/v8/onboarding/wizard.module.css'

/** 登録の④でも、はじめの質問と同じ見本を見てからスタイルを選ぶ。 */
export default function RegistrationStyleDialog({ open, choice, busy, ready, error, onChoose, onSave, onSkip, onClose }: {
  open: boolean
  choice: AccountStyle | ''
  busy: boolean
  ready: boolean
  error: string
  onChoose: (style: AccountStyle) => void
  onSave: () => void
  onSkip: () => void
  onClose: () => void
}) {
  const [viewing, setViewing] = useState<AccountStyle>(() => choice || 'restaurant')
  useEffect(() => { if (choice) setViewing(choice) }, [choice])
  if (!open) return null
  return <Dialog
    open
    title="使い方のスタイルを選ぶ"
    titleHelp={<HelpTip label="使い方のスタイルの説明">ダッシュボードと初期設定が、選んだスタイルに合わせて変わります。あとから設定で変更できます。</HelpTip>}
    initialFocusId={STYLE_CHOICE_START_ID}
    size="wide"
    designTop={60}
    fitViewport
    designNode="xxpM9"
    onCancel={onClose}
    busy={busy}
    error={error}
    footerDivider={false}
    designFooterPadding="16px 24px"
    designContentPadding="16px 24px 24px"
    footer={<DialogActions><div className={styles.footer}>
      <div className={styles.footerSide}><Button type="button" variant="text" onClick={onSkip} disabled={busy || !ready}>あとで設定する</Button></div>
      <div className={styles.footerCenter}><Button type="button" variant="primary" onClick={onSave} disabled={busy || !ready || !choice} busy={busy} busyLabel="保存しています…" disabledReason={!choice ? 'スタイルを選んでください' : null}>次へ<ArrowRight size={16} aria-hidden="true" /></Button></div>
      <div className={styles.footerEnd}><StyleChoiceStatus chosen={choice || null} /></div>
    </div></DialogActions>}
  >
    <div className={styles.body}>
      <div className={styles.progress}>
        <span className={styles.progressCount}>登録の手順 4 / 5</span>
        <ProgressBar appearance="quota" className={styles.track} value={4} max={5} label="登録の進み" />
        <span className={styles.progressName}>使い方のスタイル</span>
      </div>
      <StyleChoiceStep viewing={viewing} onView={setViewing} chosen={choice || null} onChoose={onChoose} disabled={busy} />
      <p className={styles.where}><Info aria-hidden="true" className={styles.whereIcon} />あとから変えられます（設定 › アカウント）。</p>
    </div>
  </Dialog>
}

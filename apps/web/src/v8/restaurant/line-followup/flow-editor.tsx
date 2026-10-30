'use client'

import { Utensils } from 'lucide-react'
import type { BroadcastBubble } from '@line-crm/shared'
import Card from '@/components/shared/card'
import { Field } from '@/components/shared/form-controls'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import { TextArea } from '@/components/shared/text-field'
import LinePreview from '@/components/shared/line-preview'
import MessageComposer from '@/components/shared/message-composer'
import styles from './line-followup.module.css'

/*
 * 行の本文の編集。かんたんな設定はこの画面（テキスト1通）、
 * 複数の吹き出しなどの細かい直しは本体のシナリオ画面でする。
 * 吹き出しの枠はシナリオ・一斉配信と同じ共通の MessageComposer を、1通だけの形で使う。
 */
const TEXT_ONLY = 'LINE来店フォローは、いまはテキスト1通だけ入れられます。'
const UNAVAILABLE = {
  image: TEXT_ONLY, video: TEXT_ONLY, audio: TEXT_ONLY, sticker: TEXT_ONLY, carousel: TEXT_ONLY,
  rich_message: TEXT_ONLY, rich_video: TEXT_ONLY, location: TEXT_ONLY, research: TEXT_ONLY, intro: TEXT_ONLY, coupon: TEXT_ONLY,
} as const

export function bubbleText(bubble: BroadcastBubble | null | undefined): string {
  const text = bubble?.content?.text
  return typeof text === 'string' ? text : ''
}

export function StepEditor({ name, bubbles, readOnly, busy, onChange }: {
  name: string; bubbles: BroadcastBubble[]; readOnly: boolean; busy: boolean
  onChange: (bubbles: BroadcastBubble[]) => void
}) {
  const noop = () => {}
  const current = bubbles[0] ?? { id: 'draft', type: 'text', content: { text: '' } }
  return <Card variant="form" padding="default" gap="normal" aria-label={`${name} の中身`}>
    <div className={styles.contentHead}>
      <h3 className={styles.contentTitle}>{`${name} の中身`}</h3>
      <span className={styles.contentNote}>右の LINE での見え方がそのまま変わります</span>
    </div>
    <SaveErrorField names={['messageBubbles', 'body']}>
      {readOnly
        ? <Field label="本文" fill><TextArea value={bubbleText(current)} readOnly /></Field>
        : <MessageComposer bubblesOnly bubbles={[current]} accountId={null} busy={busy} unavailable={UNAVAILABLE}
            onChange={(_index, next) => onChange([{ ...next, id: current.id }])}
            onMove={noop} onDelete={noop} onAdd={noop} onPickTemplate={noop} onSaveTemplate={noop} onCompose={noop} />}
    </SaveErrorField>
  </Card>
}

export function StepPreview({ bubbles, accountName, photo }: { bubbles: BroadcastBubble[]; accountName: string; photo: 'A' | 'B' | 'C' | 'D' }) {
  const text = bubbleText(bubbles[0])
  return <LinePreview title={null} accountName={accountName} fit>
    <div className={styles.rich}>
      <div className={`${styles.photo} ${photo === 'B' ? styles.photoB : photo === 'C' ? styles.photoC : photo === 'D' ? styles.photoD : styles.photoA}`}><Utensils aria-hidden className={styles.photoIcon} /></div>
      <div className={styles.richText}>
        <p className={styles.richBody}>{text || '本文'}</p>
      </div>
      <p className={styles.richAction}>予約内容を確認</p>
    </div>
  </LinePreview>
}

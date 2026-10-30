'use client'

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

/** 読むだけの欄に出す全文。2通以上あっても先頭だけにしない。 */
export function allBubbleText(bubbles: BroadcastBubble[]): string {
  return bubbles.map(bubbleText).filter(text => text !== '').join('\n\n')
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
        ? <Field label="本文" fill><TextArea value={allBubbleText(bubbles)} readOnly /></Field>
        : <MessageComposer bubblesOnly bubbles={[current]} accountId={null} busy={busy} unavailable={UNAVAILABLE}
            onChange={(_index, next) => onChange([{ ...next, id: current.id }])}
            onMove={noop} onDelete={noop} onAdd={noop} onPickTemplate={noop} onSaveTemplate={noop} onCompose={noop} />}
    </SaveErrorField>
  </Card>
}

/* 送る中身そのままの見え方。送らない画像やボタンは付けない。 */
export function StepPreview({ bubbles, accountName }: { bubbles: BroadcastBubble[]; accountName: string }) {
  const texts = bubbles.map(bubbleText).filter(text => text !== '')
  return <LinePreview title={null} accountName={accountName} fit>
    {texts.length ? texts.map((text, index) => <p key={index} className={styles.talkBubble}>{text}</p>) : <p className={styles.talkBubble}>本文</p>}
  </LinePreview>
}

'use client'

import { Utensils } from 'lucide-react'
import type { BroadcastBubble } from '@line-crm/shared'
import Card from '@/components/shared/card'
import { Field } from '@/components/shared/form-controls'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import { TextArea, TextField } from '@/components/shared/text-field'
import LinePreview from '@/components/shared/line-preview'
import MessageComposer from '@/components/shared/message-composer'
import type { RestaurantLineFlow } from '@/lib/restaurant-test-api'
import styles from './line-followup.module.css'

export type FlowDraft = { title: string; body: string }

/*
 * 今の保存先（rt_line_flows）は1つのフォローに「題」と「本文（テキスト1通）」しか持てない。
 * 絵の2通目のカルーセル・画像などの形は、保存の口ができるまで置かない（機能待ち）。
 * 吹き出しの枠はシナリオ・一斉配信と同じ共通の MessageComposer を、1通だけの形で使う。
 */
const TEXT_ONLY = 'LINE来店フォローは、いまはテキスト1通だけ入れられます。'
const UNAVAILABLE = {
  image: TEXT_ONLY, video: TEXT_ONLY, audio: TEXT_ONLY, sticker: TEXT_ONLY, carousel: TEXT_ONLY,
  rich_message: TEXT_ONLY, rich_video: TEXT_ONLY, location: TEXT_ONLY, research: TEXT_ONLY, intro: TEXT_ONLY, coupon: TEXT_ONLY,
} as const

export function FlowEditor({ flow, name, draft, readOnly, busy, onChange }: {
  flow: RestaurantLineFlow; name: string; draft: FlowDraft; readOnly: boolean; busy: boolean
  onChange: (draft: FlowDraft) => void
}) {
  const bubble: BroadcastBubble = { id: flow.id, type: 'text', content: { text: draft.body } }
  const noop = () => {}
  return <Card variant="form" padding="default" gap="normal" aria-label={`${name} の中身`}>
    <div className={styles.contentHead}>
      <h3 className={styles.contentTitle}>{`${name} の中身`}</h3>
      <span className={styles.contentNote}>右の LINE での見え方がそのまま変わります</span>
    </div>
    <Field label="タイトル" fill><SaveErrorField names={["title"]}>
      <TextField value={draft.title} onChange={event => onChange({ ...draft, title: event.target.value })} readOnly={readOnly} disabled={busy} />
    </SaveErrorField></Field>
    <SaveErrorField names={["body"]}>
      {readOnly
        ? <Field label="本文" fill><TextArea value={draft.body} readOnly /></Field>
        : <MessageComposer bubblesOnly bubbles={[bubble]} accountId={null} busy={busy} unavailable={UNAVAILABLE}
            onChange={(_index, next) => onChange({ ...draft, body: String(next.content.text ?? '') })}
            onMove={noop} onDelete={noop} onAdd={noop} onPickTemplate={noop} onSaveTemplate={noop} onCompose={noop} />}
    </SaveErrorField>
  </Card>
}

export function FlowPreview({ flow, draft, accountName }: { flow: RestaurantLineFlow; draft: FlowDraft; accountName: string }) {
  return <LinePreview title={null} accountName={accountName} fit>
    <div className={styles.rich}>
      <div className={`${styles.photo} ${flow.flow_type === 'reservation_2h' ? styles.photoB : flow.flow_type === 'post_visit' ? styles.photoC : flow.flow_type === 'review_request' ? styles.photoD : styles.photoA}`}><Utensils aria-hidden className={styles.photoIcon} /></div>
      <div className={styles.richText}>
        <p className={styles.richTitle}>{draft.title || 'タイトル'}</p>
        <p className={styles.richBody}>{draft.body || '本文'}</p>
      </div>
      <p className={styles.richAction}>予約内容を確認</p>
    </div>
  </LinePreview>
}

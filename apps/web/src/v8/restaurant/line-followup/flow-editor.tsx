'use client'

import { Utensils } from 'lucide-react'
import Button from '@/components/shared/button'
import FormSection from '@/components/shared/form-section'
import { Field } from '@/components/shared/form-controls'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import { TextArea, TextField } from '@/components/shared/text-field'
import LinePreview from '@/components/shared/line-preview'
import type { RestaurantLineFlow } from '@/lib/restaurant-test-api'
import styles from './line-followup.module.css'

export type FlowDraft = { title: string; body: string }

export function FlowEditor({ flow, name, draft, readOnly, busy, onChange, onSave }: {
  flow: RestaurantLineFlow; name: string; draft: FlowDraft; readOnly: boolean; busy: boolean
  onChange: (draft: FlowDraft) => void; onSave: () => void
}) {
  return <FormSection id={`followup-${flow.id}`} title={name}>
    <Field label="タイトル" fill><SaveErrorField names={["title"]}>
      <TextField value={draft.title} onChange={event => onChange({ ...draft, title: event.target.value })} readOnly={readOnly} disabled={busy} />
    </SaveErrorField></Field>
    <Field label="本文" fill><SaveErrorField names={["body"]}>
      <TextArea value={draft.body} onChange={event => onChange({ ...draft, body: event.target.value })} readOnly={readOnly} disabled={busy} />
    </SaveErrorField></Field>
    {readOnly ? null : <Button disabled={busy} busy={busy} onClick={onSave}>下書きを保存する</Button>}
  </FormSection>
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

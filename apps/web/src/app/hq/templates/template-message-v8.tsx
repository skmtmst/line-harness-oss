'use client'

import { useState } from 'react'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import {
  EMPTY_TEMPLATE_REFERENCES,
  MessageTemplateEditor,
} from '@/components/templates/message-template-editor'
import type { MessageTemplateDefinition } from '@/lib/hq-templates-api'
import { withUploadedImage } from '@/lib/hq-template-authoring'
import { ImageUpload } from './template-definition-editor'
import styles from './template-console.module.css'

/*
 * 板 X4JcOf：メッセージのひな形を作る（V8だけ）。
 * 絵の「ひな形の中身＋右に LINE の見え方＋一段のひな形を保存」。
 * 保存する中身は今の口のまま（名前・分類・形式・画像・本文）。
 * 口に無い欄（タイトル・ボタン）は見た目だけ置かず、報告に残す。
 */

const MESSAGE_TYPE_OPTIONS = [
  { value: 'text', label: 'テキスト' },
  { value: 'image', label: '画像' },
  { value: 'flex', label: 'カード型' },
  // 既存データを開いて保存しても形式を落とさない。
  { value: 'carousel', label: 'カルーセル' },
]

export default function TemplateMessageFormV8({
  name,
  onNameChange,
  value,
  onChange,
  disabled,
  busy,
  validation,
  createUncertain,
  catalogFailed,
  onReloadCatalog,
  onBusyChange,
  onReceipt,
  onSave,
}: {
  name: string
  onNameChange: (name: string) => void
  value: MessageTemplateDefinition
  onChange: (next: MessageTemplateDefinition) => void
  disabled: boolean
  busy: boolean
  validation: string | null
  createUncertain: boolean
  catalogFailed: boolean
  onReloadCatalog: () => void
  onBusyChange?: (busy: boolean) => void
  onReceipt?: (media: MessageTemplateDefinition['media'][number]) => void
  onSave: () => void
}) {
  const [targetDate, setTargetDate] = useState('')
  const current = value.template
  return (
    <>
      {catalogFailed ? (
        <Notice
          tone="warn"
          message="参照先の候補を読み込めませんでした。タグ・テンプレート・回答フォームは選べません。"
          action={<Button onClick={onReloadCatalog}>もう一度読み込む</Button>}
        />
      ) : null}
      {createUncertain ? (
        <>
          <Notice tone="warn" message="前回の保存結果がまだ確定していません。重複を防ぐため入力を固定しています。同じ依頼を再確認し、保存済みならその結果を読み込みます。" />
          <div className={styles.footer}><Button variant="primary" disabled={busy} onClick={onSave}>前回の保存を再確認</Button></div>
        </>
      ) : (
        <MessageTemplateEditor
          value={{ messageType: current.messageType, messageContent: current.messageContent }}
          onChange={(next) => onChange({
            ...value,
            template: {
              ...current,
              messageType: next.messageType as MessageTemplateDefinition['template']['messageType'],
              messageContent: next.messageContent,
            },
          })}
          targetDate={targetDate}
          onTargetDateChange={setTargetDate}
          references={EMPTY_TEMPLATE_REFERENCES}
          referenceAccountId={null}
          referenceUnavailableHint="友だち情報と共通情報はアカウントごとに異なるため、配布先のLINEアカウントで設定してください。"
          disabled={disabled}
          typeOptions={MESSAGE_TYPE_OPTIONS}
          bodyAriaLabel="配信する本文"
          beforeType={(
            <>
              <h2>ひな形の中身</h2>
              <label className={styles.field}>
                <span>ひな形の名前</span>
                <input aria-label="ひな形の名前" className={styles.input} value={name} maxLength={200} disabled={disabled} onChange={(event) => onNameChange(event.target.value)} />
              </label>
              <label className={styles.field}>
                <span>分類 <small className={styles.muted}>任意</small></span>
                <input aria-label="テンプレートの分類" className={styles.input} value={current.category} maxLength={100} disabled={disabled} onChange={(event) => onChange({ ...value, template: { ...current, category: event.target.value } })} />
              </label>
            </>
          )}
          afterType={(
            <>
              {value.media.map((media) => <p key={media.id} className={styles.muted}>{media.filename}（{Math.ceil(media.sizeBytes / 1024)} KB）<br /><span className={styles.name}>{media.publicUrl ?? media.r2Key}</span></p>)}
              {current.id === 'hq-authored-message' && <ImageUpload purpose="message" disabled={disabled} onBusyChange={onBusyChange} onReceipt={onReceipt} onUploaded={(media) => onChange(withUploadedImage(value, media))} />}
            </>
          )}
          footer={(
            <div className={styles.footer}>
              <Button variant="primary" disabled={busy || Boolean(validation)} onClick={onSave}>ひな形を保存</Button>
            </div>
          )}
        />
      )}
    </>
  )
}

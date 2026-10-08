'use client'

/*
 * ★V8 統括 テンプレート「メッセージのひな形を作る」（板 X4JcOf）。
 * 左に「ひな形の中身」（名前・分類・形式・画像・タイトル・本文・ボタン）、右に LINE での見え方。
 * 保存する中身（HqMessageCard と template 本体）・画像の受け取り・ボタンの参照先は今の画面
 * （app/hq/templates/template-definition-editor.tsx の CardEditor・template-message-v8.tsx）と同じ。
 * 画像・カルーセルの形式は、今までどおり共通の MessageTemplateEditor で編集する。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ImageIcon, Plus, X } from 'lucide-react'
import type { HqMessageCard, HqMessageReference, HqTemplateFolder } from '@line-crm/shared'
import { hqTemplatesApi, type MessageTemplateDefinition } from '@/lib/hq-templates-api'
import { withMessageCard, withUploadedImage } from '@/lib/hq-template-authoring'
import { EMPTY_TEMPLATE_REFERENCES, MessageTemplateEditor } from '@/components/templates/message-template-editor'
import LinePreview, { LinePreviewMessage } from '@/components/shared/line-preview'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import FolderSelect from '@/components/shared/folder-select'
import { decodeImageSize, type TemplateMedia } from './definition'
import styles from './console.module.css'

const FORMATS = [
  { value: 'text', label: 'テキスト' },
  { value: 'image', label: '画像' },
  { value: 'flex', label: 'カード型' },
  { value: 'carousel', label: 'カルーセル' },
] as const
type Format = typeof FORMATS[number]['value']

const ACTIONS: Array<{ value: HqMessageCard['buttons'][number]['action']; label: string }> = [
  { value: 'url', label: 'URL を開く' },
  { value: 'message', label: 'メッセージを送る' },
  { value: 'form', label: '回答フォームを開く' },
  { value: 'scenario', label: 'シナリオを始める' },
]

export interface MessageFormProps {
  name: string
  onNameChange: (name: string) => void
  value: MessageTemplateDefinition
  onChange: (next: MessageTemplateDefinition) => void
  folders: HqTemplateFolder[]
  folderId: string | null
  onFolderChange: (id: string | null) => void
  /** フォルダを選ぶ欄からその場で作る（dLffh）。閲覧のみは渡さない。 */
  onCreateFolder?: (name: string) => Promise<{ value: string; label: string }>
  folderLoadFailed: boolean
  disabled: boolean
  catalogFailed: boolean
  onReloadCatalog: () => void
  onBusyChange?: (busy: boolean) => void
  onReceipt?: (media: TemplateMedia) => void
  /** 下に出す「前回の保存を再確認」などの知らせ。 */
  notice?: ReactNode
}

export default function MessageForm({
  name, onNameChange, value, onChange, folders, folderId, onFolderChange, onCreateFolder, folderLoadFailed,
  disabled, catalogFailed, onReloadCatalog, onBusyChange, onReceipt, notice,
}: MessageFormProps) {
  const current = value.template
  const [advanced, setAdvanced] = useState(false)
  const [targetDate, setTargetDate] = useState('')
  const [references, setReferences] = useState<HqMessageReference[]>([])
  const [referenceError, setReferenceError] = useState('')
  // カード（タイトル・本文・ボタン）で作るか。今の画面と同じ判定：保存済みのカード、または新しく作ったテキスト。
  const usesCard = !advanced && (Boolean(value.card) || (current.id === 'hq-authored-message' && (current.messageType === 'text' || current.messageType === 'flex') && !current.carouselActionsJson && !current.questionJson))
  const card: HqMessageCard = value.card ?? { format: current.messageType === 'flex' ? 'flex' : 'text', title: '', body: current.messageContent, buttons: [] }
  const format: Format = usesCard ? card.format : current.messageType

  const loadReferences = () => hqTemplatesApi.messageReferences()
    .then((rows) => { setReferences(rows); setReferenceError('') })
    .catch(() => setReferenceError('ボタンの参照先を読み込めませんでした。入力を残したまま再読み込みできます。'))
  useEffect(() => {
    let alive = true
    void hqTemplatesApi.messageReferences()
      .then((rows) => { if (alive) setReferences(rows) })
      .catch(() => { if (alive) setReferenceError('ボタンの参照先を読み込めませんでした。入力を残したまま再読み込みできます。') })
    return () => { alive = false }
  }, [])

  const updateCard = (next: HqMessageCard) => onChange(withMessageCard(value, next))
  const updateButton = (id: string, patch: Partial<HqMessageCard['buttons'][number]>) => updateCard({ ...card, buttons: card.buttons.map((button) => button.id === id ? { ...button, ...patch } : button) })
  const chooseFormat = (next: Format) => {
    if (next === 'text' || next === 'flex') {
      setAdvanced(false)
      updateCard({ ...card, format: next })
      return
    }
    // 画像・カルーセルは今までの詳細編集（カードを外し、形式だけ変える）。
    setAdvanced(true)
    const { card: _removed, ...rest } = value
    onChange({ ...rest, template: { ...current, messageType: next } })
  }
  const image = value.media.find((item) => item.id === card.imageMediaId) ?? value.media[0]

  return (
    <div className={styles.editSplit}>
      <section className={styles.editPanel} aria-label="ひな形の中身">
        {catalogFailed ? (
          <Notice tone="warn" message="参照先の候補を読み込めませんでした。タグ・テンプレート・回答フォームは選べません。" action={<Button onClick={onReloadCatalog}>もう一度読み込む</Button>} />
        ) : null}
        <h2 className={styles.editTitle}>ひな形の中身</h2>
        <div className={styles.twoCol}>
          <label className={styles.field}>
            <span className={styles.label}>ひな形の名前</span>
            <input aria-label="ひな形の名前" className={styles.input} value={name} maxLength={200} disabled={disabled} onChange={(event) => onNameChange(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>分類 <small className={styles.optional}>任意</small></span>
            <input aria-label="テンプレートの分類" className={styles.input} value={current.category} maxLength={100} disabled={disabled} onChange={(event) => onChange({ ...value, template: { ...current, category: event.target.value } })} />
          </label>
        </div>
        <div className={styles.field}>
          <span className={styles.smallLabel}>形式</span>
          <div className={styles.formatRow}>
            <div className={styles.segment} role="radiogroup" aria-label="ひな形の形式">
              {FORMATS.map((option) => (
                <button key={option.value} type="button" role="radio" aria-checked={format === option.value} className={styles.segmentItem} disabled={disabled} onClick={() => chooseFormat(option.value)}>{option.label}</button>
              ))}
            </div>
            <span className={styles.folderPick}>
              <FolderSelect aria-label="フォルダ" label="フォルダ" value={folderId ?? ''} disabled={disabled || folderLoadFailed} onChange={(next) => onFolderChange(next || null)} folders={folders.map((folder) => ({ value: folder.id, label: folder.name }))} onCreate={onCreateFolder} colors={false} />
            </span>
          </div>
        </div>

        {usesCard ? <>
          {card.format === 'flex' && (
            <div className={styles.field}>
              <span className={styles.smallLabel}>画像 <small className={styles.optional}>PNG・JPEG、1件8 MiB以下</small></span>
              <div className={styles.imageBox}>
                {image?.publicUrl ? <span className={styles.thumb} role="img" aria-label={image.filename} style={{ backgroundImage: `url(${JSON.stringify(image.publicUrl)})` }} /> : <span className={styles.thumb} aria-hidden="true" />}
                <span className={styles.imageName}>{image ? `${image.filename} ・ ${image.width ?? '—'}×${image.height ?? '—'}` : 'まだ画像がありません'}</span>
                {card.imageMediaId ? <Button size="compact" variant="text" disabled={disabled} onClick={() => { const { imageMediaId: _removed, ...next } = card; updateCard(next) }}><X size={14} aria-hidden="true" />画像を外す</Button> : null}
                <ImagePick disabled={disabled} onBusyChange={onBusyChange} onReceipt={onReceipt} onUploaded={(media) => { const next = withUploadedImage(value, media); onChange(withMessageCard(next, { ...card, imageMediaId: media.id })) }} />
              </div>
            </div>
          )}
          <label className={styles.field}>
            <span className={styles.label}>タイトル</span>
            <input className={styles.input} aria-label="ひな形のタイトル" maxLength={200} value={card.title} disabled={disabled} onChange={(event) => updateCard({ ...card, title: event.target.value })} />
          </label>
          <label className={styles.field}>
            <span className={styles.smallLabel}>本文</span>
            <textarea className={styles.textarea} aria-label="配信する本文" maxLength={card.format === 'flex' ? 2000 : 5000} value={card.body} disabled={disabled} onChange={(event) => updateCard({ ...card, body: event.target.value })} />
          </label>
          {card.format === 'flex' && (
            <div className={styles.buttonsBox}>
              <span className={styles.smallLabel}>ボタン <small className={styles.optional}>最大 3 つ</small></span>
              {referenceError && <Notice tone="warn" message={referenceError} action={<Button disabled={disabled} onClick={() => void loadReferences()}>参照先を再読み込み</Button>} />}
              {card.buttons.map((button, index) => (
                <div key={button.id} className={styles.buttonEdit}>
                  <div className={styles.twoCol}>
                    <label className={styles.field}>
                      <span className={styles.label}>ボタンの文字</span>
                      <input className={styles.input} aria-label={`ボタン${index + 1}の文字`} maxLength={20} disabled={disabled} value={button.label} onChange={(event) => updateButton(button.id, { label: event.target.value })} />
                    </label>
                    <div className={styles.field}>
                      <span className={styles.smallLabel}>押したとき</span>
                      <Select aria-label={`ボタン${index + 1}を押したとき`} size="full" disabled={disabled} value={button.action} onChange={(next) => updateButton(button.id, { action: next as typeof button.action, value: '' })} options={ACTIONS} />
                    </div>
                  </div>
                  {button.action === 'form' || button.action === 'scenario' ? (
                    <div className={styles.field}>
                      <span className={styles.labelRow}>
                        <span className={styles.label}>参照先</span>
                        <button type="button" className={styles.textButton} disabled={disabled} onClick={() => updateCard({ ...card, buttons: card.buttons.filter((row) => row.id !== button.id) })}>{`ボタン${index + 1}を外す`}</button>
                      </span>
                      <Select
                        aria-label={`ボタン${index + 1}の参照先`} size="full"
                        disabled={disabled || Boolean(referenceError)}
                        value={button.value}
                        onChange={(next) => updateButton(button.id, { value: next })}
                        options={[
                          { value: '', label: '選択してください' },
                          ...(button.value && !references.some((row) => row.kind === button.action && row.id === button.value) ? [{ value: button.value, label: '保存済みの参照先（候補を確認してください）' }] : []),
                          ...references.filter((row) => row.kind === button.action).map((row) => ({ value: row.id, label: `${row.name}（${row.accountName}）` })),
                        ]}
                      />
                    </div>
                  ) : (
                    <div className={styles.field}>
                      <span className={styles.labelRow}>
                        <label className={styles.label} htmlFor={`hq-button-value-${button.id}`}>{button.action === 'url' ? 'タップ先URL' : '送るメッセージ'}</label>
                        <button type="button" className={styles.textButton} disabled={disabled} onClick={() => updateCard({ ...card, buttons: card.buttons.filter((row) => row.id !== button.id) })}>{`ボタン${index + 1}を外す`}</button>
                      </span>
                      <input id={`hq-button-value-${button.id}`} className={styles.input} aria-label={`ボタン${index + 1}の内容`} maxLength={button.action === 'message' ? 300 : 2000} disabled={disabled} value={button.value} onChange={(event) => updateButton(button.id, { value: event.target.value })} />
                    </div>
                  )}
                </div>
              ))}
              <span className={styles.addButtonRow}>
                <Button disabled={disabled || card.buttons.length >= 3} onClick={() => updateCard({ ...card, buttons: [...card.buttons, { id: crypto.randomUUID(), label: '', action: 'url', value: '' }] })}><Plus size={15} aria-hidden="true" />ボタンを足す</Button>
              </span>
              <p className={styles.note}>押したときは URL を開く・メッセージを送る・回答フォームを開く・シナリオを始める から選べます</p>
              <p className={styles.noteStrong}>タグ・回答フォームがあるかは、アカウントへ配る前の確認で調べます（ない所は配る前に知らせます）。</p>
            </div>
          )}
        </> : (
          <MessageTemplateEditor
            value={{ messageType: current.messageType, messageContent: current.messageContent }}
            onChange={(next) => onChange({ ...value, template: { ...current, messageType: next.messageType as MessageTemplateDefinition['template']['messageType'], messageContent: next.messageContent } })}
            targetDate={targetDate}
            onTargetDateChange={setTargetDate}
            references={EMPTY_TEMPLATE_REFERENCES}
            referenceAccountId={null}
            referenceUnavailableHint="友だち情報と共通情報はアカウントごとに異なるため、配布先のLINEアカウントで設定してください。"
            disabled={disabled}
            typeOptions={FORMATS.map((option) => ({ value: option.value, label: option.label }))}
            bodyAriaLabel="配信する本文"
            afterType={(
              <>
                {value.media.map((media) => <p key={media.id} className={styles.note}>{`${media.filename}（${Math.ceil(media.sizeBytes / 1024)} KB）`}</p>)}
                {current.id === 'hq-authored-message' && <ImagePick disabled={disabled} onBusyChange={onBusyChange} onReceipt={onReceipt} onUploaded={(media) => onChange(withUploadedImage(value, media))} />}
              </>
            )}
          />
        )}
        {notice}
      </section>

      <aside className={styles.previewColumn} aria-label="LINE の見え方">
        <LinePreview accountName="然 - NEN -" empty={!card.title && !card.body && !current.messageContent ? '中身を入れると、ここに LINE での見え方が出ます。' : false}>
          {usesCard && card.format === 'flex' ? (
            <div className={styles.previewRow}>
            <span className={styles.previewAvatar} aria-hidden="true">然</span>
            <div className={styles.previewCard}>
              {image?.publicUrl ? <span className={styles.previewImage} style={{ backgroundImage: `url(${JSON.stringify(image.publicUrl)})` }} aria-hidden="true" /> : <span className={styles.previewImage} aria-hidden="true" />}
              <span className={styles.previewCopy}>
                <strong>{card.title || 'タイトル'}</strong>
                <span>{card.body}</span>
              </span>
              {card.buttons.map((button) => <span key={button.id} className={styles.previewAction}>{button.label || 'ボタン'}</span>)}
            </div>
            <span className={styles.previewTime}>10:00</span>
            </div>
          ) : (
            <LinePreviewMessage accountName="然 - NEN -" avatar="然" time="10:00">{usesCard ? [card.title, card.body].filter(Boolean).join('\n') : current.messageContent}</LinePreviewMessage>
          )}
        </LinePreview>
      </aside>
    </div>
  )
}

/** 画像を選んで送る。R568：今の大きさで採用できない画像は送る前に止め、受け取りを先に残す。 */
function ImagePick({ disabled, onUploaded, onBusyChange, onReceipt }: { disabled: boolean; onUploaded: (media: TemplateMedia) => void; onBusyChange?: (busy: boolean) => void; onReceipt?: (media: TemplateMedia) => void }) {
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  const locked = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false; onBusyChange?.(false) } }, [onBusyChange])
  const upload = async (file?: File) => {
    if (!file || disabled || locked.current) return
    locked.current = true; setUploading(true); onBusyChange?.(true); setError('')
    try {
      await decodeImageSize(file)
      const media = await hqTemplatesApi.uploadImage(file, 'message')
      if (alive.current) { onReceipt?.(media); onUploaded(media) }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '画像を登録できませんでした。')
    } finally {
      locked.current = false
      if (alive.current) { setUploading(false); onBusyChange?.(false) }
    }
  }
  return (
    <span className={styles.imagePick}>
      <input ref={input} className={styles.fileInput} aria-label="メッセージ画像を選ぶ" type="file" accept="image/png,image/jpeg" disabled={disabled || uploading} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file) }} />
      <Button disabled={disabled || uploading} busy={uploading} busyLabel="画像を登録しています…" onClick={() => input.current?.click()}><ImageIcon size={15} aria-hidden="true" />メッセージ画像を選ぶ</Button>
      {error && <span role="alert" className={styles.fieldError}>{error}</span>}
    </span>
  )
}

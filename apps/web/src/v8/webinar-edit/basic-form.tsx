'use client'

/*
 * ★V8 ウェビナーの①基本設定の中身（Pencil j7PP04）。作る（/webinars/new）と編集の①の両方で使う。
 * カード3枚：基本設定（名前・公開ページの URL・フォルダ・案内文）／開催形式／だれに案内するか。
 */
import type { ReactNode } from 'react'
import { CalendarDays, Play } from 'lucide-react'
import Button from '@/components/shared/button'
import HelpTip from '@/components/shared/help-tip'
import LinePreview, { LinePreviewMessage } from '@/components/shared/line-preview'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Select from '@/components/shared/select'
import { RequiredBadge } from '@/components/shared/form-controls'
import { TextField } from '@/components/shared/text-field'
import type { WebinarFolder } from '@/lib/api'
import { ReadValue } from './parts'
import styles from './form.module.css'

export type BasicValues = {
  title: string
  slug: string
  folderId: string
  description: string
  deliveryKind: 'on_demand' | 'scheduled' | 'external'
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function BasicForm({
  idPrefix,
  values,
  onChange,
  folders,
  folderState,
  onReloadFolders,
  audienceLabel,
  fieldErrors,
  onBlurTitle,
  onBlurSlug,
  disabled,
  readOnly = false,
}: {
  idPrefix: string
  values: BasicValues
  onChange: (patch: Partial<BasicValues>) => void
  folders: WebinarFolder[]
  folderState: 'loading' | 'ready' | 'error'
  onReloadFolders: () => void
  audienceLabel: string
  fieldErrors: { title?: string; slug?: string }
  onBlurTitle?: () => void
  onBlurSlug?: () => void
  disabled: boolean
  /** 閲覧のみ。選ぶ欄は押せない形にせず、値の文字で見せる。 */
  readOnly?: boolean
}) {
  const folderOptions = [
    { value: '', label: '未分類' },
    ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
    ...(values.folderId && !folders.some((folder) => folder.id === values.folderId) ? [{ value: values.folderId, label: '今のフォルダ' }] : []),
  ]
  return (
    <>
      <section className={styles.card} aria-labelledby={`${idPrefix}-basic`}>
        <div className={styles.cardHead}>
          <h2 id={`${idPrefix}-basic`} className={styles.cardTitle}>基本設定</h2>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${idPrefix}-title`}>名前<RequiredBadge /></label>
          <TextField
            id={`${idPrefix}-title`}
            value={values.title}
            disabled={disabled}
            readOnly={readOnly}
            placeholder="NEN活用スタートセミナー"
            invalid={Boolean(fieldErrors.title)}
            onChange={(event) => onChange({ title: event.target.value })}
            onBlur={onBlurTitle}
          />
          {fieldErrors.title ? <p className={styles.fieldError} role="alert">{fieldErrors.title}</p> : null}
        </div>
        <div className={styles.pair}>
          <div className={styles.field}>
            <span className={styles.label}>
              <label htmlFor={`${idPrefix}-slug`}>公開ページの URL</label>
              <HelpTip label="公開ページの URL の説明">アドレスの最後の部分です。半角の英小文字・数字・ハイフンで入れます。作るときに空のままなら自動で付けます。</HelpTip>
            </span>
            <TextField
              id={`${idPrefix}-slug`}
              value={values.slug}
              disabled={disabled}
              readOnly={readOnly}
              placeholder="nen-start"
              inputMode="url"
              invalid={Boolean(fieldErrors.slug)}
              onChange={(event) => onChange({ slug: event.target.value })}
              onBlur={onBlurSlug}
            />
            {fieldErrors.slug ? <p className={styles.fieldError} role="alert">{fieldErrors.slug}</p> : null}
          </div>
          <div className={styles.field}>
            <label className={styles.labelSmall} htmlFor={`${idPrefix}-folder`}>フォルダ</label>
            {readOnly
              ? <ReadValue label="フォルダ">{folderOptions.find((option) => option.value === values.folderId)?.label ?? '未分類'}</ReadValue>
              : <Select id={`${idPrefix}-folder`} aria-label="フォルダ" size="full" value={values.folderId} disabled={disabled || folderState !== 'ready'} onChange={(value) => onChange({ folderId: value })} options={folderOptions} />}
            {folderState === 'error' ? (
              <p className={styles.help}>フォルダを読み込めませんでした。<Button size="compact" onClick={onReloadFolders}>もう一度読み込む</Button></p>
            ) : null}
          </div>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${idPrefix}-description`}>案内文</label>
          <TextField
            id={`${idPrefix}-description`}
            value={values.description}
            disabled={disabled}
            readOnly={readOnly}
            placeholder="15分で NEN の使い方がわかる無料セミナーです"
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </div>
      </section>

      <section className={styles.card} aria-labelledby={`${idPrefix}-kind`}>
        <div className={styles.cardHead}>
          <h2 id={`${idPrefix}-kind`} className={styles.cardTitle}>開催形式</h2>
          <p className={styles.cardNote}>あとから動画の段でも変えられます</p>
        </div>
        {/* 閲覧のみ：選ぶ部品は置かず、選んでいる形式を文字で見せる（2026-10-06 オーナー決定）。 */}
        {readOnly ? (
          <ReadValue label="開催形式">{values.deliveryKind === 'scheduled' ? '日時指定配信' : values.deliveryKind === 'on_demand' ? 'オンデマンド配信' : '外部の動画'}</ReadValue>
        ) : (
          <RadioCardGroup legend="開催形式" className={styles.radioPair}>
            <RadioCard name={`${idPrefix}-delivery`} value="on_demand" checked={values.deliveryKind === 'on_demand'} disabled={disabled} onChange={() => onChange({ deliveryKind: 'on_demand' })} title="オンデマンド配信" note="録画動画をいつでも視聴" icon={<Play size={16} />} />
            <RadioCard name={`${idPrefix}-delivery`} value="scheduled" checked={values.deliveryKind === 'scheduled'} disabled={disabled} onChange={() => onChange({ deliveryKind: 'scheduled' })} title="日時指定配信" note="指定日時に公開開始" icon={<CalendarDays size={16} />} />
          </RadioCardGroup>
        )}
        {values.deliveryKind === 'external' ? <p className={styles.help}>今は外部の動画を使っています。別の形式を選ぶまでそのままです。</p> : null}
      </section>

      <section className={styles.card} aria-labelledby={`${idPrefix}-audience`}>
        <div className={styles.cardHead}>
          <h2 id={`${idPrefix}-audience`} className={styles.cardTitle}>だれに案内するか</h2>
        </div>
        <div className={styles.field}>
          <label className={styles.labelSmall} htmlFor={`${idPrefix}-audience-select`}>案内する相手</label>
          {readOnly
            ? <ReadValue label="案内する相手">{audienceLabel}</ReadValue>
            : <Select id={`${idPrefix}-audience-select`} aria-label="案内する相手" size="full" value="registered" disabled={disabled} onChange={() => {}} options={[{ value: 'registered', label: audienceLabel }]} />}
          <p className={styles.help}>タグ「配信済み」は確認の段で足せます</p>
        </div>
      </section>
    </>
  )
}

/** LINE での見え方（申込の案内の1通目）。 */
export function BasicPreview({ title, description, accountName, action }: { title: string; description: string; accountName: string; action?: ReactNode }) {
  return (
    <>
      <LinePreview accountName={accountName} caption="いま">
        <LinePreviewMessage accountName={accountName} avatar={accountName.trim().charAt(0) || 'L'} time="">
          {`【無料セミナー】${title.trim() || '（ウェビナー名）'}`}
          <br />
          {description.trim() || 'セミナーの案内文がここに出ます。'}
          <br />
          ▶ 申込はこちら
        </LinePreviewMessage>
      </LinePreview>
      {action}
    </>
  )
}

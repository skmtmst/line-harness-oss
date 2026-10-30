'use client'

import { cloneElement, useEffect, useId, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react'
import SegmentedControl from './segmented'
import FilterChip from './filter-chip'
import { TextField } from './text-field'
import { Field } from './form-controls'
import { SaveErrorField, useSaveErrorReveal } from './save-form-errors'
import styles from './composer-stickers.module.css'
import { useContentChangeAccess, type ContentChangeAccess } from './use-content-change-access'
import { usePermissionLockTip } from './permission-lock-tip'

// LINE公開の基本スタンプ。https://developers.line.biz/en/docs/messaging-api/sticker-list/
const PACKS = [
  { id: '11537', label: 'ブラウン＆コニー', stickers: ['52002734', '52002735', '52002736', '52002737', '52002738', '52002739', '52002740', '52002741', '52002742', '52002743', '52002744', '52002745', '52002746', '52002747', '52002748', '52002749'] },
  { id: '446', label: 'ムーン', stickers: ['1988', '1989', '1990', '1991', '1992', '1993', '2000', '2001'] },
  { id: '789', label: 'サリー', stickers: ['10855', '10856', '10857', '10877'] },
] as const
/** 公開されている基本スタンプの、番号だけでは分からない名前。 */
export const STICKER_LABELS: Readonly<Record<string, string>> = {
  '1988': 'にっこり', '1989': 'うれしい', '1990': 'ありがとう', '1991': 'よろしく',
  '1992': 'おねがい', '1993': 'なるほど', '2000': 'ごめんなさい', '2001': 'びっくり',
  '10855': 'OK', '10856': 'はい', '10857': 'いいね', '10877': 'おつかれさま',
}
export const STICKER_IMAGE_PATHS = ['android/sticker.png', 'iPhone/sticker@2x.png'] as const
function Thumb({ id, label, imagePaths }: { id: string; label?: string; imagePaths?: readonly string[] }) {
  const [attempt, setAttempt] = useState(0)
  const paths = imagePaths?.length ? imagePaths : ['android/sticker.png']
  return attempt >= paths.length ? <span>{label ?? id}</span> : <img width={72} height={72} alt={label ?? `スタンプ ${id}`} src={`https://stickershop.line-scdn.net/stickershop/v1/sticker/${id}/${paths[attempt]}`} onError={() => setAttempt(current => current + 1)} />
}
function StickerButton({ lockedReason, canChangeNow, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { lockedReason?: string; canChangeNow: () => boolean }) {
  const lock = usePermissionLockTip<HTMLButtonElement>(lockedReason, props['aria-describedby'])
  return <><button {...props} ref={lock.ref} {...lock.handlers} onClick={event => {
    if (lock.handlers) { lock.handlers.onClick(event); return }
    if (canChangeNow()) onClick?.(event)
  }} />{lock.node}</>
}
function StickerManual({ lockedReason, children }: { lockedReason?: string; children: ReactNode }) {
  const lock = usePermissionLockTip<HTMLDivElement>(lockedReason)
  const { disabled: _nativeDisabled, ...handlers } = lock.handlers ?? {}
  return <><div className={styles.manual} ref={lock.ref} role={lockedReason ? 'group' : undefined} aria-label={lockedReason ? 'スタンプの番号' : undefined} tabIndex={lockedReason ? 0 : undefined} {...handlers}>{children}</div>{lock.node}</>
}
function StickerModeField({ names, children }: { names: string[]; children: ReactElement<{ id?: string }> }) {
  const id = useId()
  return <SaveErrorField names={names}>{cloneElement(children, { id })}</SaveErrorField>
}
function StickerInputField({ label, names, children }: { label: string; names: string[]; children: ReactElement<{ id?: string }> }) {
  return <Field label={label} required grow><SaveErrorField names={names}>{children}</SaveErrorField></Field>
}
function StickerFieldReveal({ names, onReveal }: { names: string[]; onReveal: () => void }) {
  useSaveErrorReveal(names, onReveal)
  return null
}
type StickerValue = { packageId: string; stickerId: string }
type StickerFieldNames = { mode?: string[]; packageId: string[]; stickerId: string[] }
export default function ComposerStickers({ value, onChange, disabled, lockedReason, canChangeNow, fieldNames, labels, imagePaths, description, syncSelection = false }: ContentChangeAccess & {
  value: StickerValue
  onChange: (next: StickerValue) => void
  /** 指定時だけ、欄ごとに保存失敗と必須の印を結び付ける。 */
  fieldNames?: StickerFieldNames
  labels?: Readonly<Record<string, string>>
  imagePaths?: readonly string[]
  description?: string
  /** 外から読み戻した番号に、表示中のパックを追従させる。 */
  syncSelection?: boolean
}) {
  const permission = useContentChangeAccess({ disabled, lockedReason, canChangeNow })
  const change = (next: typeof value) => { if (permission.canChangeNow()) onChange(next) }
  const [mode, setMode] = useState<'pick' | 'manual'>(() => syncSelection && value.packageId && !PACKS.some(pack => pack.id === value.packageId) ? 'manual' : 'pick')
  const [packId, setPackId] = useState(value.packageId || '11537')
  const pack = PACKS.find((item) => item.id === packId) ?? PACKS[0]
  useEffect(() => {
    if (!syncSelection) return
    if (PACKS.some(pack => pack.id === value.packageId)) setPackId(value.packageId)
    else if (value.packageId) setMode('manual')
  }, [syncSelection, value.packageId, value.stickerId])
  const input = (name: 'packageId' | 'stickerId') => {
    const control = <TextField inputMode="numeric" aria-label={fieldNames ? (name === 'packageId' ? 'パッケージID' : 'スタンプID') : undefined} value={value[name]} disabled={permission.provided ? permission.blocked : undefined} onChange={(event) => change({ ...value, [name]: event.target.value })} />
    const label = name === 'packageId' ? 'パッケージID' : 'スタンプID'
    return fieldNames ? <StickerInputField label={label} names={fieldNames[name]}>{control}</StickerInputField> : <label>{label}{control}</label>
  }
  const fields = <>{input('packageId')}{input('stickerId')}</>
  const modePicker = <SegmentedControl size="sticker" aria-label="スタンプの決め方" options={[{ value: 'pick', label: '一覧から選ぶ' }, { value: 'manual', label: '番号を直接入れる' }]} value={mode} onChange={setMode} />
  return <div className={styles.root}>
    {fieldNames ? <StickerFieldReveal names={[...fieldNames.packageId, ...fieldNames.stickerId]} onReveal={() => setMode('manual')} /> : null}
    {description ? <p>{description}</p> : null}
    {fieldNames?.mode ? <StickerModeField names={fieldNames.mode}>{modePicker}</StickerModeField> : modePicker}
    {mode === 'pick' ? <><div className={styles.packs}>{PACKS.map((item) => <FilterChip size="compact" showCheck={false} key={item.id} selected={pack.id === item.id} onChange={() => setPackId(item.id)}>{item.label}</FilterChip>)}</div><div className={styles.grid}>{pack.stickers.map((id) => permission.provided ? <StickerButton key={id} type="button" aria-label={labels?.[id] ?? `スタンプ ${id}`} aria-pressed={value.packageId === pack.id && value.stickerId === id} disabled={permission.disabled} lockedReason={lockedReason} canChangeNow={permission.canChangeNow} onClick={() => change({ packageId: pack.id, stickerId: id })}><Thumb id={id} label={labels?.[id]} imagePaths={imagePaths} /></StickerButton> : <button key={id} type="button" aria-label={labels?.[id] ?? `スタンプ ${id}`} aria-pressed={value.packageId === pack.id && value.stickerId === id} onClick={() => onChange({ packageId: pack.id, stickerId: id })}><Thumb id={id} label={labels?.[id]} imagePaths={imagePaths} /></button>)}</div></> : permission.provided ? <StickerManual lockedReason={lockedReason}>{fields}</StickerManual> : <div className={styles.manual}>{fields}</div>}
    {value.packageId && value.stickerId ? <p>{`選んだスタンプ：${labels?.[value.stickerId] ? `${labels[value.stickerId]}・` : ''}パッケージ ${value.packageId}・スタンプ ${value.stickerId}`}</p> : null}
  </div>
}

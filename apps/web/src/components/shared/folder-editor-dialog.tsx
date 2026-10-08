'use client'

import type { ComponentProps, ReactNode } from 'react'
import { useId } from 'react'
import Dialog from './dialog'
import Button from './button'
import { TextField } from './text-field'
import FolderColorButton, { type FolderColorOption } from './folder-color-button'
import { isImeComposing } from './ime'
import styles from './folder-editor-dialog.module.css'

export interface FolderNameColorFieldsProps {
  name: string
  onNameChange: (name: string) => void
  color: string | null
  onColorChange: (color: string | null) => void
  colors: ReadonlyArray<FolderColorOption>
  allowClear?: boolean
  disabled?: boolean
  nameId?: string
  nameLabel?: string
  placeholder?: string
  maxLength?: number
  onSubmit?: () => void
}

/** 名前と色は必ず同じ行。画面側から部品の見た目を上書きしない。 */
export function FolderNameColorFields({ name, onNameChange, color, onColorChange, colors, allowClear, disabled, nameId, nameLabel = 'フォルダ名', placeholder = '例：購入', maxLength = 100, onSubmit }: FolderNameColorFieldsProps) {
  const generatedId = useId()
  const id = nameId ?? generatedId
  return <div className={styles.row} data-folder-name-color="">
    <div className={styles.name}>
      <label htmlFor={id} className={styles.label}>{nameLabel}</label>
      <TextField id={id} value={name} onChange={(event) => onNameChange(event.target.value)} autoFocus
        placeholder={placeholder} maxLength={maxLength} disabled={disabled}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !isImeComposing(event) && name.trim() && !disabled) { event.preventDefault(); onSubmit?.() }
        }} />
    </div>
    <div className={styles.color}>
      <span className={styles.label}>色</span>
      <FolderColorButton value={color} onChange={onColorChange} colors={colors} allowClear={allowClear} disabled={disabled} />
    </div>
  </div>
}

type Props = FolderNameColorFieldsProps & Pick<ComponentProps<typeof Dialog>, 'open' | 'title' | 'description' | 'busy' | 'error' | 'onCancel' | 'onConfirm' | 'confirmLabel' | 'cancelLabel' | 'confirmDisabled' | 'designNode' | 'designTop'> & {
  children?: ReactNode
  footer?: ReactNode
  confirmIcon?: ReactNode
  confirmTitle?: string
}

/** IjVpM の低い窓。保存先やエラー処理は画面が持ち、形はここに集約する。 */
export default function FolderEditorDialog({ name, onNameChange, color, onColorChange, colors, allowClear, disabled, nameId, nameLabel, placeholder, maxLength, children, footer, confirmIcon, confirmTitle, confirmLabel = '追加する', cancelLabel = 'キャンセル', onConfirm, busy, confirmDisabled, ...dialog }: Props) {
  return <Dialog {...dialog} busy={busy} designWidth={560} designHeaderPadding="24px 24px 0"
    footer={<div className={styles.footer}>{footer ?? <>
      <Button type="button" onClick={dialog.onCancel} disabled={busy}>{cancelLabel}</Button>
      <Button type="button" variant="primary" onClick={onConfirm} title={confirmTitle}
        disabled={busy || confirmDisabled || !name.trim()} busy={busy}>{confirmIcon}{confirmLabel}</Button>
    </>}</div>}>
    <div className={styles.body}>
      {children}
      <FolderNameColorFields name={name} onNameChange={onNameChange} color={color} onColorChange={onColorChange}
        colors={colors} allowClear={allowClear} disabled={disabled || busy} nameId={nameId} nameLabel={nameLabel}
        placeholder={placeholder} maxLength={maxLength} onSubmit={confirmDisabled ? undefined : onConfirm} />
    </div>
  </Dialog>
}

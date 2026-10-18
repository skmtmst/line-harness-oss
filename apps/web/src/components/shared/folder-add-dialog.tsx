'use client'

/*
 * フォルダを1つ足す窓。Pencil V5 の `CsGTC`（共通 フォルダ 追加・編集・削除）。
 *
 * シナリオ・タグ・一斉配信・リマインダ…と、分類を持つ画面すべてで同じものを
 * 出す。画面ごとに書き写していたので、色の並びや「やめる／追加する」の
 * 文言が少しずつ違っていた。1か所にまとめる。
 *
 * 違うのは `kind` だけ。フォルダは `folders.kind` で画面ごとに分かれている。
 */

import { useOptionalAccount } from '@/contexts/account-context'
import { useState } from 'react'
import { api } from '@/lib/api'
import { FOLDER_SELECT_COLORS, type Folder } from '@line-crm/shared'
import FolderEditorDialog from './folder-editor-dialog'
import { describeFolderFailure } from './folder-failure'
import { folderDisplayColor } from './folder-dot'
import { notifyToast } from './toast'

/** フォルダの色。全画面で同じ8色を使う。 */
export const FOLDER_COLORS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#6B7280',
]

/** 既存の保存色を保ち、色の選択肢は名前で読み上げる。 */
export const FOLDER_COLOR_NAMES: Record<string, string> = {
  '#3B82F6': '青', '#10B981': '緑', '#F59E0B': '黄', '#EF4444': '赤',
  '#8B5CF6': '紫', '#EC4899': 'ピンク', '#06B6D4': '水色', '#6B7280': 'グレー',
}

export interface FolderAddDialogProps {
  /** `folders.kind`。'broadcast' / 'scenario' など。 */
  kind: string
  /**
   * 直すフォルダ。渡すと**追加ではなく名前と色を直す窓**になる。
   *
   * 設計 `CzndJ` の「名前を変更」「色を変える」。窓を2つ作らないのは、
   * 入れる項目が同じで、離すと文言や色の並びがまたずれるため。
   */
  folder?: Folder
  /**
   * フォルダの持ち主のLINE公式アカウント。明示指定を優先する。
   * 作成時の未指定は現在の選択アカウントを使い、共通操作の権限はAPIで確認する。
   */
  accountId?: string | null
  /** 窓の下に出す一言。「消しても中身は未分類に残る」など。 */
  note?: string
  /** 例に出す名前。 */
  placeholder?: string
  onClose: () => void
  /** 追加できたら呼ぶ。一覧を読み直す。 */
  onAdded: (folder?: Folder) => void
  /**
   * ほかの人が先に直した・消した（409・404）ときにフォルダの一覧を読み直す。
   * 消されていたときは読み直したあと窓を閉じる（onClose）。
   */
  onReload?: () => void | Promise<void>
}

export default function FolderAddDialog({
  kind,
  folder,
  accountId,
  note,
  placeholder = '例: 01_キャンペーン',
  onClose,
  onAdded,
  onReload,
}: FolderAddDialogProps) {

  const selectedAccount = useOptionalAccount()
  const targetAccountId = accountId === undefined ? selectedAccount?.selectedAccountId : accountId
  const [name, setName] = useState(folder?.name ?? '')
  const [color, setColor] = useState<string | null>((folder ? folderDisplayColor(folder) : FOLDER_SELECT_COLORS[0].value))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [nameError, setNameError] = useState('')

  const add = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError('')
    setNameError('')
    try {
      // `api.folders.update` の実体は部分更新をそのまま送る。変数にまとめて、
      // 名前だけ直して選んだ色を捨てる以前の挙動へ戻さない。
      const folderUpdates = { name: trimmed, color }
      const res = folder
        ? await api.folders.update(folder.id, folderUpdates, accountId ?? undefined)
        : await api.folders.create({ kind, name: trimmed, color, accountId: targetAccountId })
      if (!res.success) {
        setError(res.error)
        return
      }
      onAdded(res.data)
      onClose()
    } catch (caught) {
      // 理由ごとに言い分ける（共通の describeFolderFailure）。入力した名前と色は残す。
      const failure = describeFolderFailure(caught, 'save')
      if (failure.kind === 'missing') {
        notifyToast(failure.message, { tone: 'error' })
        await onReload?.()
        onClose()
        return
      }
      if (failure.kind === 'conflict') await onReload?.()
      if (failure.nameError) setNameError(failure.nameError)
      else setError(failure.message)
    } finally {
      setSaving(false)
    }
  }

  return <FolderEditorDialog open
    title={folder ? 'フォルダを直す' : 'フォルダを追加'} description={note}
    name={name} onNameChange={(next) => { setName(next); setNameError('') }} color={color} onColorChange={setColor}
    nameError={nameError || undefined}
    allowClear
    placeholder={placeholder} busy={saving} error={error || undefined}
    onCancel={onClose} onConfirm={() => void add()} confirmLabel={folder ? '保存する' : '追加する'}
  />

}

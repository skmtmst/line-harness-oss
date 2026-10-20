import type { ReactNode } from 'react'
import type { TagEditorValues } from '@/components/friend-fields/tag-editor-v4'



/*
 * ★V8 タグ：タグの編集（一から書いた画面・2026-10-07）。
 * Pencil：タグの編集 、競合 、閲覧のみ 。
 *
 * 型は「作る」（CreatePage）：頭（戻る・タグ名・フォルダと人数）→ 左に「基本」「タグ連動」「マイル」、
 * 右に「使っている所」、下の帯（削除は左端・キャンセル／複製して作る／保存は中央）。
 * 「タグ連動」「マイル」は畳んで1行の要約を出し、「開く」で中身を出す（絵どおり）。
 * 動き（読み込み・保存・さかのぼり反映の確認・競合・削除・アーカイブ）は今の画面（src/v8/tag-edit/edit）と同じ。
 */

export interface TagEditHost {
  initialValues: TagEditorValues
  title: string
  saveLabel?: string
  onSaveDraft?: (values: TagEditorValues) => void
  description: string
  notice?: ReactNode
  preview: (values: TagEditorValues) => ReactNode
  onSaveAnother: (values: TagEditorValues) => void
  allowedActionTypes: readonly import('@/components/friend-fields/tag-editor-v4').TagEditorActionLabel[]
}

import type { Tag, TagGroup } from '@line-crm/shared'
import type { FolderSelectCreate } from '@/components/shared/folder-select'
import type { TagDependencies } from '@/lib/api'
import type { LinkedAction } from '@/components/friend-fields/tag-editor-v4'

export type TagEditFormProps = {
  host?: TagEditHost
  tag: Tag
  groups: TagGroup[]
  /** その場でフォルダを作る（dLffh）。閲覧のみは渡さない。 */
  onCreateGroup?: FolderSelectCreate
  dependencies: TagDependencies | null
  accountId: string
  readOnly: boolean
  conflict: boolean
  compareBusy: boolean
  onCompare: () => void
  onReloadLatest: () => void
  retroactiveReference: boolean
  initialActions: LinkedAction[]
  saving: boolean
  error: string
  onCancel: () => void
  onSave: (values: TagEditorValues, applyRetroactive: boolean, previewToken?: string) => Promise<void>
  onDelete: () => void
}

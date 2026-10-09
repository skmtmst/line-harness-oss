'use client'

import type { HqTemplateFolder, Tag, TagGroup } from '@line-crm/shared'
import type { TagDefinition } from '@/lib/hq-templates-api'
import { TagEditForm } from '@/v8/tag-edit/edit'
import { hqTagDefinitionToEditor, hqTagEditorToDefinition } from '@/components/friend-fields/hq-tag-definition-editor'
import { type TagEditorValues } from '@/components/friend-fields/tag-editor-v4'
import Notice from '@/components/shared/notice'
import TagPill from '@/components/shared/tag-pill'
import Button from '@/components/shared/button'
import type { FolderSelectCreate } from '@/components/shared/folder-select'
import styles from './tag-editor.module.css'
import { folderDisplayColor } from '@/components/shared/folder-dot'

/** 店のV8編集フォームの入力・並べ替え・マイルと、統括の保存先をつなぐ。店のAPIは呼ばない。 */
export default function HqTagEditorV8({ definition, folders = [], onCreateFolder, editing, saving, readOnly = false, conflict = false, error, notice, onReloadLatest, onCancel, onSave, onSaveDraft }: {
  definition: TagDefinition
  /** 統括のフォルダ（左の列と同じ）。所属フォルダはここから選ぶ。 */
  folders?: HqTemplateFolder[]
  /** 所属フォルダの欄から、その場でフォルダを作る（左の列の「フォルダを追加」と同じ口）。 */
  onCreateFolder?: FolderSelectCreate
  editing: boolean
  saving: boolean
  readOnly?: boolean
  conflict?: boolean
  onReloadLatest?: () => void
  error?: string
  notice?: string
  onCancel: () => void
  onSaveDraft?: (definition: TagDefinition) => Promise<void>
  onSave: (definition: TagDefinition, andAnother?: boolean) => Promise<void>
}) {
  const initialValues = hqTagDefinitionToEditor(definition)
  const now = new Date().toISOString()
  /* 所属フォルダの候補＝統括のフォルダ（左の列と同じ）。ひな形に前から入っているフォルダで統括に無いものも残す。 */
  const choices = [
    ...folders.map((folder) => ({ id: folder.id, name: folder.name, color: folder.color ?? null })),
    ...definition.folders.filter((folder) => !folders.some((row) => row.id === folder.id)).map((folder) => ({ id: folder.id, name: folder.name, color: folder.color ?? null })),
  ]
  const groups: TagGroup[] = choices.map((folder, sortOrder) => ({
    id: folder.id, name: folder.name, color: folder.color, accountId: null, sortOrder, createdAt: now, updatedAt: now,
  }))
  /* 選んだフォルダをひな形の中にも入れる（配った先で同じ名前・色のフォルダになる）。 */
  const withFolder = (next: TagDefinition): TagDefinition => {
    const chosen = choices.find((folder) => folder.id === next.tag.folderId)
    if (!chosen || next.folders.some((folder) => folder.id === chosen.id)) return next
    return { ...next, folders: [...next.folders, { id: chosen.id, name: chosen.name, color: chosen.color }] }
  }
  const tag = {
    id: 'hq-template', name: initialValues.name, groupId: initialValues.groupId,
    isStarred: initialValues.isStarred, mileageReward: initialValues.rewardMiles,
    referralMileageReward: initialValues.referralRewardMiles, mileageMultiplierBps: initialValues.multiplierBps,
    mileageMultiplierPriority: initialValues.multiplierPriority, reapplyPolicy: initialValues.reapplyPolicy,
    createdAt: now, updatedAt: now,
  } as Tag
  const save = async (values: TagEditorValues, another = false) => {
    if (saving || readOnly || !values.name.trim()) return
    await onSave(withFolder(hqTagEditorToDefinition(definition, values)), another)
  }
  const preview = (values: TagEditorValues) => {
    const folder = groups.find((group) => group.id === values.groupId)
    const steps = [
      definition.tag.manualAssignmentAllowed === false ? 'このタグは手で付けず、連携や自動処理から付けます。' : '一覧・チャット・CSV から、このタグを手で付けられます。',
      values.linked ? 'タグが付いたら、設定したマイルと連動アクションが動きます。' : '連動はOFFなので、付いてもマイル付与やメッセージ送信は動きません。',
      values.linked && values.multiplierBps ? `今後の獲得マイルは ${values.multiplierBps / 10000} 倍になります。` : '今後の獲得マイルは変わりません。',
      values.linked && values.actions.length ? `${values.actions.length} 件の連動アクションを上から順に実行します。` : '配信の絞り込み・シナリオの開始条件・自動応答の付与先として選べます。',
    ]
    return <div className={styles.preview}>
      <h3 className={styles.title}>できあがるタグ</h3>
      <div className={styles.chips}><TagPill name={values.name || 'タグ名'} color={folder ? folderDisplayColor(folder) : null} /><span className={styles.folder}>{folder?.name ?? '未分類'}</span></div>
      <p className={styles.copy}>このタグは、配信の絞り込み・シナリオの開始条件・自動応答の付与先として使えます。</p>
      <h3 className={`${styles.title} ${styles.effectsTitle}`}>この設定で起きること</h3>
      <ol className={styles.steps}>{steps.map((text, index) => <li key={index}><span className={styles.number}>{index + 1}</span><span>{text}</span></li>)}</ol>
      <Notice tone="warn" icon={null}><div className={styles.warning}><strong>保存しただけでは、まだ誰にも届きません</strong><p>ひな形を保存しても各アカウントにはまだ作られません。一覧の［配る］で選んだアカウントへ配ると、そのアカウントのタグになります。</p></div></Notice>
    </div>
  }
  return <TagEditForm
    tag={tag} groups={groups} onCreateGroup={readOnly ? undefined : onCreateFolder} dependencies={null} accountId="" readOnly={readOnly}
    conflict={false} compareBusy={false} onCompare={() => undefined} onReloadLatest={() => undefined}
    retroactiveReference={false} initialActions={initialValues.actions} saving={saving} error={conflict ? '' : error ?? ''}
    onCancel={onCancel} onDelete={() => undefined} onSave={(values) => save(values)}
    host={{ initialValues, title: editing ? 'タグのひな形を編集' : 'タグのひな形を作る',
      saveLabel: onSaveDraft ? '保存する' : editing ? '変更を保存する' : 'タグを作る',
      onSaveDraft: onSaveDraft ? (values) => { void onSaveDraft(withFolder(hqTagEditorToDefinition(definition, values))) } : undefined,
      notice: conflict && error ? <Notice tone="warn" message={error} action={onReloadLatest ? <Button disabled={saving} onClick={onReloadLatest}>最新の内容を読み込む</Button> : undefined} /> : undefined,
      description: notice ?? '保存したひな形は、一覧の［配る］で各 LINE アカウントへ配ります。',
      preview, onSaveAnother: (values) => { void save(values, true) }, allowedActionTypes: ['テキスト送信', 'マイル付与'] }}
  />
}

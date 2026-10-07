'use client'

/*
 * 情報欄タブ（Q5F2QE の 4.）。その人について決めた項目を2列に並べ、最後に1回保存する。
 * 分類（すべて・基本・フォルダ）は URL の group で選ぶ（FRIEND-21・今と同じ指定）。
 * 権限が無い人は欄が押せず、保存ボタンを置かずに理由だけ出す（N-045）。
 */
import Link from 'next/link'
import { Lock } from 'lucide-react'
import type { FriendField } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import DateField from '@/components/shared/date-field'
import Select from '@/components/shared/select'
import { FIELD_TYPE_LABELS } from '@/components/friend-fields/field-list'
import { TextArea, TextField } from '@/components/shared/text-field'
import type { FriendDetailState } from './use-friend-detail'
import type { FriendDetailPermissions } from './permissions'
import styles from './detail.module.css'

/** 種類の名前は絵では出さない。ラベルの title で読めるようにする。 */
export const BASIC_GROUP = 'basic'
export const ALL_GROUP = 'all'

function FieldInput({ field, value, onChange, disabled, id }: {
  field: FriendField
  value: string
  onChange: (v: string) => void
  disabled: boolean
  id: string
}) {
  const readOnly = disabled || !!field.ecIsMaster
  if (field.type === 'textarea') {
    return <TextArea id={id} rows={3} value={value} disabled={readOnly} onChange={(e) => onChange(e.target.value)} />
  }
  if (field.type === 'multi_select') {
    // 複数選択を単一選択で保存すると既存の複数値が黙って上書きされる（#496-16）。読むだけ。
    const parts = value ? value.split(/[,、]\s*/).filter(Boolean) : []
    return (
      <div className={styles.multi} aria-labelledby={`${id}-label`}>
        {parts.length ? parts.map((p) => <span key={p} className={styles.tag}>{p}</span>) : <span className={styles.faint}>未入力</span>}
      </div>
    )
  }
  if (field.type === 'select') {
    return (
      <Select
        id={id}
        size="full"
        value={value}
        disabled={readOnly}
        onChange={(v) => onChange(v)}
        aria-label={`${field.name}の値`}
        options={[{ value: '', label: '— 未設定 —' }, ...(field.options ?? []).map((o) => ({ value: o, label: o }))]}
      />
    )
  }
  if (field.type === 'checkbox') {
    return (
      <Checkbox id={id} checked={value === '1'} disabled={readOnly} onCheckedChange={(c) => onChange(c ? '1' : '')} aria-label={`${field.name}：はい`}>はい</Checkbox>
    )
  }
  if (field.type === 'date') {
    return <DateField id={id} value={value} onChange={onChange} disabled={readOnly} aria-labelledby={`${id}-label`} placeholder="未入力" />
  }
  const inputType = field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : field.type === 'tel' ? 'tel' : field.type === 'email' ? 'email' : 'text'
  return <TextField id={id} type={inputType} value={value} disabled={readOnly} placeholder="未入力" onChange={(e) => onChange(e.target.value)} />
}

export default function InfoTab({ friendId, group, data, perms }: {
  friendId: string
  group: string
  data: FriendDetailState
  perms: FriendDetailPermissions
}) {
  const { fields, values, setValues, fieldsStatus, fieldFolders, fieldFoldersStatus, hiddenPersonalCount } = data

  if (fieldsStatus === 'loading' || fieldsStatus === 'idle') {
    return <div className={styles.pane}><p className={styles.paneNote}>情報欄を読み込んでいます…</p></div>
  }
  if (fieldsStatus === 'error') {
    return (
      <div className={`${styles.pane} ${styles.centered}`} role="alert">
        <p className={styles.paneNote}>情報欄を読み込めませんでした。</p>
        <Button onClick={() => void data.loadFields()}>もう一度読み込む</Button>
      </div>
    )
  }

  // 「基本」は分類のない項目、「すべて」は分類をまたいだ全項目。★つきは基本のときだけ先頭へ。
  const inGroup = group === ALL_GROUP ? fields : group === BASIC_GROUP ? fields.filter((f) => !f.folderId) : fields.filter((f) => f.folderId === group)
  const ordered = group === BASIC_GROUP ? [...inGroup.filter((f) => f.isStarred), ...inGroup.filter((f) => !f.isStarred)] : inGroup

  const folderCount = new Map<string, number>()
  let unfiled = 0
  for (const f of fields) {
    if (!f.folderId) unfiled += 1
    else folderCount.set(f.folderId, (folderCount.get(f.folderId) ?? 0) + 1)
  }
  const folderIds = new Set(fieldFolders.map((f) => f.id))
  const orphan = [...folderCount.keys()].filter((id) => !folderIds.has(id))
  const chips = [
    { id: ALL_GROUP, label: 'すべて', count: fields.length },
    { id: BASIC_GROUP, label: '基本', count: unfiled },
    ...fieldFolders.map((f) => ({ id: f.id, label: f.name, count: folderCount.get(f.id) ?? 0 })),
    ...orphan.map((id) => ({ id, label: '分類', count: folderCount.get(id) ?? 0 })),
  ]
  const groupKnown = group === BASIC_GROUP || group === ALL_GROUP || folderIds.has(group) || folderCount.has(group) || fieldFoldersStatus !== 'ready'
  const base = `/friends/detail?id=${encodeURIComponent(friendId)}&tab=info`

  return (
    <div className={styles.pane}>
      <div className={styles.chips} role="group" aria-label="情報欄の分類">
        {chips.map((chip) => (
          <Link
            key={chip.id}
            className={styles.chip}
            href={chip.id === BASIC_GROUP ? base : `${base}&group=${encodeURIComponent(chip.id)}`}
            aria-current={group === chip.id ? 'true' : undefined}
          >
            {`${chip.label} ${chip.count}`}
          </Link>
        ))}
      </div>

      {!groupKnown ? (
        <p className={styles.paneNote}>
          この分類は削除されたか、見つかりません。
          <Link className={styles.srcLink} href={base}>基本の項目を見る</Link>
        </p>
      ) : ordered.length === 0 ? (
        <div className={styles.centered}>
          {hiddenPersonalCount > 0 ? <p className={styles.hiddenNote}>個人情報の項目が {hiddenPersonalCount} 件あります。表示には個人情報の閲覧権限が要ります。</p> : null}
          <p className={styles.paneNote}>
            {fields.length === 0 && hiddenPersonalCount === 0
              ? '情報欄の項目がまだありません。'
              : group === BASIC_GROUP || group === ALL_GROUP ? '表示できる項目がありません。' : 'この分類の項目はまだありません。'}
          </p>
          {perms.manage && hiddenPersonalCount === 0 ? <Button href={`/tags/fields/new?back=/friends/detail?id=${friendId}`}>項目を作る</Button> : null}
        </div>
      ) : (
        <>
          <div className={styles.fieldGrid}>
            {ordered.map((field) => {
              const id = `ff-${field.id}`
              const changed = (field.value ?? '') !== (values[field.id] ?? '')
              return (
                <div key={field.id} className={styles.field} data-changed={changed || undefined}>
                  <label htmlFor={id} id={`${id}-label`} className={styles.fieldLabel} title={`${field.name}（${FIELD_TYPE_LABELS[field.type] ?? field.type}）`}>
                    {field.isStarred ? <span aria-label="★つき">★</span> : null}
                    {field.name}
                    {field.isPersonal ? <span className={styles.faint}>個人情報</span> : null}
                  </label>
                  <FieldInput
                    id={id}
                    field={field}
                    value={values[field.id] ?? ''}
                    onChange={(v) => setValues((prev) => ({ ...prev, [field.id]: v }))}
                    disabled={!perms.canEditField(field)}
                  />
                  {field.type === 'multi_select' ? <p className={styles.fieldNote}>複数選択の項目はこの画面では変更できません。</p> : null}
                  {field.ecIsMaster ? <p className={styles.fieldNote}>EC側の値が正のため、ここからは変更できません。</p> : null}
                </div>
              )
            })}
          </div>

          {hiddenPersonalCount > 0 ? <p className={styles.hiddenNote}>個人情報の項目が {hiddenPersonalCount} 件あります。表示には個人情報の閲覧権限が要ります。</p> : null}
          {data.warnings.length > 0 ? <ul className={styles.warnList}>{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}

          <div className={styles.saveBar}>
            <p className={styles.saveNote}>
              {data.saveError ? <span className={styles.danger} role="alert">{data.saveError}</span>
                : data.saveNotice ? <span className={styles.success} role="status">{data.saveNotice}</span>
                  : <><Lock size={13} aria-hidden />保存できるのはオーナー・管理者、または個人情報の編集権限を持つスタッフです。</>}
            </p>
            {perms.manage ? <Button href={`/tags/fields/new?back=/friends/detail?id=${friendId}`}>項目を作る</Button> : null}
            {perms.saveFields ? (
              <Button variant="primary" onClick={() => void data.saveFields()} disabled={data.saving} busy={data.saving} busyLabel="保存中…">保存する</Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

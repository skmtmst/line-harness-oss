'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import type { FriendField } from '@line-crm/shared'
import Button from './button'
import { ReorderHandle, RowMenu, useReorder } from './row-actions'
import Checkbox from './checkbox'
import DisplayItemsDialog from './display-items-dialog'
import { fixedFieldValue, FIXED_FRIEND_FIELDS } from './fixed-friend-field-values'
import styles from './customer-info-panel.module.css'
import AllergyField from './allergy-field'
import { TextField } from './text-field'
import { api } from '@/lib/api'
import { notifyToast } from './toast'

export type CustomerInfoSection = { key: string; label: string; action?: ReactNode; content: ReactNode }
/** 友だち概要と受信箱の共通の欄。取得・保存は呼び出し側、表示項目の好みは共通。 */
export default function CustomerInfoPanel({
  friendId, fields, state, onRetry, canEdit, sections, more, extraSections = [], hiddenPersonalCount = 0,
}: {
  friendId: string
  fields: FriendField[]
  state: 'loading' | 'ready' | 'error'
  onRetry?: () => void
  canEdit: boolean
  sections: CustomerInfoSection[]
  more?: ReactNode
  extraSections?: CustomerInfoSection[]
  hiddenPersonalCount?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const [settings, setSettings] = useState(false)
  const [hidden, setHidden] = useState<string[]>([])
  const [order, setOrder] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState<Record<string, string>>({})
  const generation = useRef(0)
  useEffect(() => { generation.current++; return () => { generation.current++ } }, [friendId, canEdit])
  // 既存受信箱の設定を引き継ぎ、概要と同じ好みを使う。顧客の値は保存しない。
  useEffect(() => {
    try {
      const previous = JSON.parse(localStorage.getItem('chat.friendInfoSections.v4') ?? '{}')
      if (Array.isArray(previous.order)) setOrder(previous.order.filter((key: unknown) => typeof key === 'string'))
      if (Array.isArray(previous.hidden)) setHidden(previous.hidden.filter((key: unknown) => typeof key === 'string'))
    } catch { /* 壊れた好みは既定表示 */ }
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (!loaded) return
    try {
      const previous = JSON.parse(localStorage.getItem('chat.friendInfoSections.v4') ?? '{}')
      localStorage.setItem('chat.friendInfoSections.v4', JSON.stringify({ ...previous, hidden, ...(order.length ? { order } : {}) }))
    } catch { /* 保存できなくてもその場の表示は使える */ }
  }, [hidden, order, loaded])
  useEffect(() => { setExpanded(false); setSettings(false); setEditing(false); setSaved({}); setSaveError(''); setSaving(false) }, [friendId, canEdit])
  const shownFields = fields.map(field => saved[field.id] === undefined ? field : { ...field, value: saved[field.id], valueSource: null })
  const sorted = [...sections].sort((a,b) => {
    const ai = order.indexOf(a.key), bi = order.indexOf(b.key)
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
  })
  const choices = [{ key: 'names', label: '基本' }, ...[...sorted, ...extraSections].map(({ key, label }) => ({ key, label }))]
  return <div className={styles.panel} data-customer-info-panel>
    {!hidden.includes('names') ? <section className={styles.section} aria-label="基本">
      <div className={styles.head}>
        <h3>基本</h3>
        {canEdit && state === 'ready' && !editing ? <Button variant="text" onClick={() => { setDraft(Object.fromEntries(shownFields.map(field => [field.id, field.value ?? '']))); setSaveError(''); setEditing(true) }}>編集</Button> : null}
      </div>
      {state === 'loading' ? <p className={styles.note}>情報欄を読み込んでいます…</p>
        : state === 'error' ? <p className={styles.note} role="alert">情報欄を読み込めませんでした <Button variant="text" onClick={onRetry}>もう一度読み込む</Button></p>
        : <dl className={styles.rows}>
          {[...FIXED_FRIEND_FIELDS].sort((a,b) => (order.indexOf(`fixed:${a.key}`) < 0 ? 999 : order.indexOf(`fixed:${a.key}`)) - (order.indexOf(`fixed:${b.key}`) < 0 ? 999 : order.indexOf(`fixed:${b.key}`))).filter(spec => !hidden.includes(`fixed:${spec.key}`) && fields.some(f => f.fixedKey === spec.key)).map(spec => {
            const { value, source, derived } = fixedFieldValue(shownFields, spec.key)
            const field = shownFields.find(field => field.fixedKey === spec.key)!
            return <div className={styles.row} key={spec.key}>
              <dt>{spec.label}</dt>
              <dd>{spec.key === 'allergy' ? <AllergyField value={editing ? draft[field.id] : field.value ?? null} options={field.options ?? undefined} readOnly={!editing || saving} onChange={next => setDraft(current => ({ ...current, [field.id]: next }))} />
                : editing && !derived ? <TextField aria-label={spec.label} readOnly={saving} value={draft[field.id] ?? ''} onChange={event => setDraft(current => ({ ...current, [field.id]: event.target.value }))} />
                : <span className={value ? styles.value : styles.note} title={value ?? undefined}>{value ?? '未設定'}</span>}{source && !editing ? <small title={source}>{source}</small> : null}</dd>
            </div>
          })}
        </dl>}
      {editing ? <><div className={styles.editActions}><Button disabled={saving} onClick={() => setEditing(false)}>キャンセル</Button><Button variant="primary" busy={saving} onClick={async () => {
        if (!canEdit || saving) return
        const started = generation.current
        setSaving(true); setSaveError('');
        const values = Object.fromEntries(shownFields.filter(field => FIXED_FRIEND_FIELDS.some(spec => spec.key === field.fixedKey) && draft[field.id] !== (field.value ?? '')).map(field => [field.id, draft[field.id]]))
        try { const result = await api.friendFields.saveForFriend(friendId, values); if (generation.current !== started) return; if (!result.success) throw new Error(result.error ?? '保存できませんでした'); setSaved(current => ({ ...current, ...values })); setEditing(false); notifyToast('保存しました'); onRetry?.() }
        catch (error) { if (generation.current === started) setSaveError(error instanceof Error ? error.message : '保存できませんでした') }
        finally { if (generation.current === started) setSaving(false) }
      }}>保存する</Button></div>{saveError ? <p className={styles.note} role="alert">{saveError}</p> : null}</> : null}
      {hiddenPersonalCount > 0 ? <p className={styles.note}>個人情報は閲覧権限が必要です。</p> : null}
    </section> : null}
    {sorted.filter(section => !hidden.includes(section.key)).map(section => <section className={styles.section} key={section.key} aria-label={section.label}>
      <div className={styles.head}><h3>{section.label}</h3>{section.action}</div>
      <div className={styles.content}>{section.content}</div>
    </section>)}
    <Button onClick={() => setExpanded(current => !current)} aria-expanded={expanded}>
      {expanded ? '顧客情報を閉じる' : '顧客情報をすべて表示'}
    </Button>
    {expanded ? <div className={styles.more}>
      <Link className={styles.action} href={`/friends/detail?id=${encodeURIComponent(friendId)}&tab=info`}>情報欄をすべて見る</Link>
      {extraSections.filter(section => !hidden.includes(section.key)).map(section => <section className={styles.section} key={section.key} aria-label={section.label}>
        <div className={styles.head}><h3>{section.label}</h3>{section.action}</div>
        <div className={styles.content}>{section.content}</div>
      </section>)}
      {more}
    </div> : null}
    {canEdit ? <Button variant="text" onClick={() => setSettings(true)}>表示項目</Button> : null}
    {settings && canEdit ? <DisplayItemsDialog title="表示項目" items={[
      ...choices.map(choice => ({...choice, group:'顧客情報の段'})),
      ...FIXED_FRIEND_FIELDS.map(spec => ({key:`fixed:${spec.key}`,label:spec.label,group:'基本'})),
    ]} selected={[...choices.map(choice => choice.key),...FIXED_FRIEND_FIELDS.map(spec => `fixed:${spec.key}`)].filter(key => !hidden.includes(key)).sort((a,b) => (order.indexOf(a)<0?999:order.indexOf(a))-(order.indexOf(b)<0?999:order.indexOf(b)))}
      manageHref="/friend-fields" onCancel={() => setSettings(false)} onConfirm={keys => {
        const all = [...choices.map(choice => choice.key),...FIXED_FRIEND_FIELDS.map(spec => `fixed:${spec.key}`)]
        setHidden(all.filter(key => !keys.includes(key))); setOrder(keys); setSettings(false)
      }} /> : null}
  </div>
}

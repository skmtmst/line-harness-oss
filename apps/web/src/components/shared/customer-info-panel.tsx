'use client'
import {japaneseDetailOf} from '@/components/shared/api-error-message'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { FileText, Settings2 } from 'lucide-react'
import HelpTip from './help-tip'
import Avatar from './avatar'
import type { FriendField } from '@line-crm/shared'
import Button from './button'
import Dialog from './dialog'
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
  friendId, profile, fields, state, onRetry, canEdit, sections, more, extraSections = [], hiddenPersonalCount = 0,
}: {
  friendId: string
  profile?: { name: string | null; pictureUrl?: string | null; addedAt: string }
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
  useEffect(() => { setSaved({}) }, [fields])
  const shownFields = fields.map(field => saved[field.id] === undefined ? field : { ...field, value: saved[field.id], valueSource: null })
  const sorted = [...sections].sort((a,b) => {
    const ai = order.indexOf(a.key), bi = order.indexOf(b.key)
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
  })
  const choices = [{ key: 'names', label: '基本' }, ...[...sorted, ...extraSections].map(({ key, label }) => ({ key, label }))]
  return <div className={styles.panel} data-customer-info-panel>
    {profile ? <div className={styles.profile}>
      <Avatar name={profile.name} src={profile.pictureUrl} size={32} />
      <span className={styles.profileName} title={profile.name ?? '名前なし'}>{profile.name ?? '名前なし'}</span>
      <span className={styles.profileDate} title={profile.addedAt}>{profile.addedAt.replace(/(\d+)年(\d+)月(\d+)日に友だち追加/, '$1/$2/$3 追加')}</span>
    </div> : null}
    {!hidden.includes('names') ? <section className={styles.section} aria-label="基本">
      <div className={styles.head}>
        <h3>基本</h3>
        {canEdit && state === 'ready' && !editing ? <Button variant="text" onClick={() => { setDraft(Object.fromEntries(shownFields.map(field => [field.id, field.value ?? '']))); setSaveError(''); setEditing(true) }}>編集</Button> : null}
      </div>
      {state === 'loading' ? <p className={styles.note}>情報欄を読み込んでいます…</p>
        : state === 'error' ? <p className={styles.note} role="alert">情報欄を読み込めませんでした <Button variant="text" onClick={onRetry}>もう一度読み込む</Button></p>
        : <dl className={styles.rows}>
          {[...FIXED_FRIEND_FIELDS].sort((a,b) => (order.indexOf(`fixed:${a.key}`) < 0 ? 999 : order.indexOf(`fixed:${a.key}`)) - (order.indexOf(`fixed:${b.key}`) < 0 ? 999 : order.indexOf(`fixed:${b.key}`))).filter(spec => spec.key !== 'age' && !hidden.includes(`fixed:${spec.key}`) && fields.some(f => f.fixedKey === spec.key)).map(spec => {
            const { value, source, derived } = fixedFieldValue(shownFields, spec.key)
            const age = spec.key === 'birthday' ? fixedFieldValue(shownFields, 'age').value : null
            const display = value && age ? `${value}（${age}歳）` : value
            const field = shownFields.find(field => field.fixedKey === spec.key)!
            return <div className={styles.row} key={spec.key}>
              <dt>{spec.label}</dt>
              <dd>{spec.key === 'allergy' ? <AllergyField value={editing ? draft[field.id] : field.value ?? null} options={field.options ?? undefined} readOnly={!editing || saving} onChange={next => setDraft(current => ({ ...current, [field.id]: next }))} />
                : editing && !derived ? <TextField aria-label={spec.label} readOnly={saving} value={draft[field.id] ?? ''} onChange={event => setDraft(current => ({ ...current, [field.id]: event.target.value }))} />
                : <span className={value ? styles.value : styles.note} title={display ?? undefined}>{display ?? '未設定'}</span>}{source && !editing ? <HelpTip hover label={`${spec.label}の出どころ`} icon={<FileText aria-hidden="true" />}>{source}</HelpTip> : null}</dd>
            </div>
          })}
        </dl>}
      {editing ? <><div className={styles.editActions}><Button disabled={saving} onClick={() => setEditing(false)}>キャンセル</Button><Button variant="primary" busy={saving} onClick={async () => {
        if (!canEdit || saving) return
        const started = generation.current
        setSaving(true); setSaveError('');
        const values = Object.fromEntries(shownFields.filter(field => FIXED_FRIEND_FIELDS.some(spec => spec.key === field.fixedKey) && draft[field.id] !== (field.value ?? '')).map(field => [field.id, draft[field.id]]))
        try { const result = await api.friendFields.saveForFriend(friendId, values); if (generation.current !== started) return; if (!result.success) throw new Error(result.error ?? '保存できませんでした'); setSaved(current => ({ ...current, ...values })); setEditing(false); notifyToast('保存しました'); onRetry?.() }
        catch (error) { if (generation.current === started) setSaveError(japaneseDetailOf(error) || '保存できませんでした') }
        finally { if (generation.current === started) setSaving(false) }
      }}>保存する</Button></div>{saveError ? <p className={styles.note} role="alert">{saveError}</p> : null}</> : null}
      {hiddenPersonalCount > 0 ? <p className={styles.note}>個人情報は閲覧権限が必要です。</p> : null}
    </section> : null}
    {sorted.filter(section => !hidden.includes(section.key)).map(section => <section className={styles.section} key={section.key} aria-label={section.label}>
      <div className={styles.head}><h3>{section.label}{section.key === 'memo' ? <HelpTip label="メモの説明">この人について担当者同士で共有するメモです。お客さまには送られません。</HelpTip> : null}</h3>{section.action}</div>
      <div className={styles.content}>{section.content}</div>
    </section>)}
    <Button onClick={() => setExpanded(current => !current)} aria-expanded={expanded}>
      {expanded ? '顧客情報を閉じる' : '顧客情報をすべて表示'}
    </Button>
    {expanded ? <div className={styles.more}>
      <Link className={styles.action} href={`/friends/detail?id=${encodeURIComponent(friendId)}&tab=info`}>情報欄をすべて見る</Link>
      {extraSections.filter(section => !hidden.includes(section.key)).map(section => <section className={styles.section} key={section.key} aria-label={section.label}>
        <div className={styles.head}><h3>{section.label}{section.key === 'memo' ? <HelpTip label="メモの説明">この人について担当者同士で共有するメモです。お客さまには送られません。</HelpTip> : null}</h3>{section.action}</div>
        <div className={styles.content}>{section.content}</div>
      </section>)}
      {more}
    </div> : null}
    {canEdit ? <Button variant="text" onClick={() => setSettings(true)}><Settings2 aria-hidden="true" />表示項目を編集</Button> : null}
    {settings && canEdit ? <DisplayItemsDialog title="表示項目" items={[
      ...choices.map(choice => ({...choice, group:'顧客情報の段'})),
      ...FIXED_FRIEND_FIELDS.filter(spec => spec.key !== 'age').map(spec => ({key:`fixed:${spec.key}`,label:spec.label,group:'基本'})),
    ]} selected={[...choices.map(choice => choice.key),...FIXED_FRIEND_FIELDS.filter(spec => spec.key !== 'age').map(spec => `fixed:${spec.key}`)].filter(key => !hidden.includes(key)).sort((a,b) => (order.indexOf(a)<0?999:order.indexOf(a))-(order.indexOf(b)<0?999:order.indexOf(b)))}
      manageHref="/friend-fields" onCancel={() => setSettings(false)} onConfirm={keys => {
        const all = [...choices.map(choice => choice.key),...FIXED_FRIEND_FIELDS.filter(spec => spec.key !== 'age').map(spec => `fixed:${spec.key}`)]
        setHidden(all.filter(key => !keys.includes(key))); setOrder(keys); setSettings(false)
      }} /> : null}
  </div>
}

/** B-212：狭い板では顧客の欄を畳み、同じ中身を小窓で開く。 */
export function CustomerInfoRail({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent || typeof ResizeObserver === 'undefined') return
    const measure = () => { const width = parent.getBoundingClientRect().width; if (width > 0) setCompact(width < 1100) }
    const observer = new ResizeObserver(measure)
    observer.observe(parent); measure()
    return () => observer.disconnect()
  }, [])
  return <div ref={ref} className={compact ? styles.railCompact : styles.rail} data-customer-rail data-collapsed={compact || undefined}>
    {compact ? <><Button onClick={() => setOpen(true)}>顧客情報</Button><Dialog open={open} title="顧客情報" onCancel={() => setOpen(false)} cancelLabel="閉じる">{children}</Dialog></> : children}
  </div>
}

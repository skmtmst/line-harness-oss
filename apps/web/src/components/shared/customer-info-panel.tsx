'use client'

import { useEffect, useState, useRef, type ReactNode } from 'react'
import Link from 'next/link'
import { FileText, Settings2 } from 'lucide-react'
import HelpTip from './help-tip'
import Avatar from './avatar'
import type { FriendField } from '@line-crm/shared'
import Button from './button'
import { ReorderHandle, RowMenu, useReorder } from './row-actions'
import Checkbox from './checkbox'
import Dialog from './dialog'
import { fixedFieldValue, FIXED_FRIEND_FIELDS } from './fixed-friend-field-values'
import styles from './customer-info-panel.module.css'

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
  useEffect(() => { setExpanded(false); setSettings(false) }, [friendId])
  const sorted = [...sections].sort((a,b) => {
    const ai = order.indexOf(a.key), bi = order.indexOf(b.key)
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
  })
  const choices = [{ key: 'names', label: '基本' }, ...[...sorted, ...extraSections].map(({ key, label }) => ({ key, label }))]
  const reorder = useReorder({
    items: sorted,
    idOf: section => section.key,
    onReorder: change => setOrder(current => [...change.ids, ...current.filter(key => !change.ids.includes(key))]),
  })
  const toggle = (key: string, visible: boolean) => setHidden(current => visible ? current.filter(k => k !== key) : [...current, key])
  return <div className={styles.panel} data-customer-info-panel>
    {profile ? <div className={styles.profile}>
      <Avatar name={profile.name} src={profile.pictureUrl} size={32} />
      <span className={styles.profileName} title={profile.name ?? '名前なし'}>{profile.name ?? '名前なし'}</span>
      <span className={styles.profileDate} title={profile.addedAt}>{profile.addedAt.replace(/(\d+)年(\d+)月(\d+)日に友だち追加/, '$1/$2/$3 追加')}</span>
    </div> : null}
    {!hidden.includes('names') ? <section className={styles.section} aria-label="基本">
      <div className={styles.head}>
        <h3>基本</h3>
        {canEdit ? <Link className={styles.action} href={`/friends/detail?id=${encodeURIComponent(friendId)}&tab=info`}>編集</Link> : null}
      </div>
      {state === 'loading' ? <p className={styles.note}>情報欄を読み込んでいます…</p>
        : state === 'error' ? <p className={styles.note} role="alert">情報欄を読み込めませんでした <Button variant="text" onClick={onRetry}>もう一度読み込む</Button></p>
        : <dl className={styles.rows}>
          {FIXED_FRIEND_FIELDS.filter(spec => spec.key !== 'age' && !hidden.includes(`fixed:${spec.key}`) && fields.some(f => f.fixedKey === spec.key)).map(spec => {
            const { value, source } = fixedFieldValue(fields, spec.key)
            const age = spec.key === 'birthday' ? fixedFieldValue(fields, 'age').value : null
            const display = value && age ? `${value}（${age}歳）` : value
            return <div className={styles.row} key={spec.key}>
              <dt>{spec.label}</dt>
              <dd><span className={value ? styles.value : styles.note} title={display ?? undefined}>{display ?? '未設定'}</span>{source ? <HelpTip hover label={`${spec.label}の出どころ`} icon={<FileText aria-hidden="true" />}>{source}</HelpTip> : null}</dd>
            </div>
          })}
        </dl>}
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
    <Button variant="text" onClick={() => setSettings(true)}><Settings2 aria-hidden="true" />表示項目を編集</Button>
    <Dialog open={settings} title="表示項目" onCancel={() => setSettings(false)} cancelLabel="閉じる">
      <div className={styles.options}>
        {choices.map(choice => <div key={choice.key} className={styles.option} {...reorder.rowProps(choice.key)}>
          {sections.some(section => section.key === choice.key) ? <ReorderHandle label={choice.label} {...reorder.handleProps(choice.key)} onMove={direction => reorder.moveBy(choice.key, direction)} /> : null}
          <Checkbox checked={!hidden.includes(choice.key)} onCheckedChange={visible => toggle(choice.key, visible)}>{choice.label}</Checkbox>
          {sections.some(section => section.key === choice.key) ? <RowMenu label={`${choice.label}の順序`} items={reorder.menuItems(choice.key)} /> : null}
        </div>)}
        <div className={styles.basicOptions} role="group" aria-label="基本の表示項目">
          {FIXED_FRIEND_FIELDS.filter(spec => spec.key !== 'age').map(spec => <Checkbox key={spec.key} checked={!hidden.includes(`fixed:${spec.key}`)} onCheckedChange={visible => toggle(`fixed:${spec.key}`, visible)}>{spec.label}</Checkbox>)}
        </div>
      </div>
    </Dialog>
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

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Circle } from 'lucide-react'
import type { SupportMark } from '@line-crm/shared'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import Breadcrumb from '@/components/shared/breadcrumb'
import Card from '@/components/shared/card'
import ListState from '@/components/shared/list-state'
import StickyBar from '@/components/shared/sticky-bar'
import SupportMarkRulesPanel from './support-mark-rules-panel'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'

const COLORS = ['#EF4B55', '#B86A00', '#06C755', '#2563D4', '#6B56CF', '#707981']
type MarkRow = SupportMark & { friendCount: number }

export default function SupportMarkEditor({ markId }: { markId?: string }) {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const editing = Boolean(markId)
  usePageTitle(editing ? '対応マークを編集' : '対応マークを追加')

  const [items, setItems] = useState<MarkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [displayOrder, setDisplayOrder] = useState(0)
  const [isDefault, setIsDefault] = useState(false)
  const [autoOnInbound, setAutoOnInbound] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selected = useMemo(() => items.find((mark) => mark.id === markId), [items, markId])
  const currentUsages = selected ? [
    selected.friendCount > 0 ? `友だち ${selected.friendCount}人` : null,
    selected.usedIn?.broadcasts ? `配信 ${selected.usedIn.broadcasts}件` : null,
    selected.usedIn?.scenarios ? `シナリオ ${selected.usedIn.scenarios}件` : null,
    selected.usedIn?.autoReplies ? `自動応答 ${selected.usedIn.autoReplies}件` : null,
    selected.usedIn?.savedSearches ? `保存した検索 ${selected.usedIn.savedSearches}件` : null,
    selected.usedIn?.automations ? `オートメーション ${selected.usedIn.automations}件` : null,
  ].filter((value): value is string => Boolean(value)) : []

  useEffect(() => {
    let cancelled = false
    if (!selectedAccountId) {
      setItems([])
      setError('LINE公式アカウントを選んでください')
      setLoading(false)
      return () => { cancelled = true }
    }
    setLoading(true)
    setError('')
    void api.supportMarks.list(selectedAccountId)
      .then((res) => {
        if (cancelled) return
        if (!res.success) throw new Error(res.error)
        const rows = res.data as MarkRow[]
        setItems(rows)
        const current = rows.find((mark) => mark.id === markId)
        if (current) {
          setName(current.name)
          setColor(current.color)
          setDisplayOrder(current.displayOrder)
          setIsDefault(current.isDefault)
          setAutoOnInbound(current.autoOnInbound)
        } else if (editing) {
          setError('対応マークが見つかりません')
        } else {
          setDisplayOrder(rows.length)
        }
      })
      .catch(() => setError('対応マークを読み込めませんでした'))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [editing, markId, selectedAccountId])

  const save = async () => {
    if (!name.trim()) return setError('マーク名を入力してください')
    if (!selectedAccountId) return setError('LINE公式アカウントを選んでください')
    setSaving(true)
    setError('')
    try {
      const result = editing && markId
        ? await api.supportMarks.update(markId, selectedAccountId, { name: name.trim(), color, displayOrder, isDefault, autoOnInbound })
        : await api.supportMarks.create(selectedAccountId, { name: name.trim(), color, displayOrder, isDefault, autoOnInbound })
      if (!result.success) throw new Error(result.error)
      router.push('/tags?tab=marks')
    } catch {
      setError('対応マークを保存できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <ListState kind="loading" />

  return (
    <div data-design-node="GMvBd">
      <div className="mb-4 flex items-center justify-between gap-4">
        <Breadcrumb items={[{ label: '対応マーク', href: '/tags?tab=marks' }, { label: editing ? 'マークを編集' : 'マークを追加' }]} />
        <Button href="/tags?tab=marks">対応マークへ</Button>
      </div>

      {error ? <p role="alert" className="mb-4 rounded-control border border-danger/20 bg-danger-bg p-3 text-sm text-danger">{error}</p> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card padding="default">
          <h2 className="mb-4 text-sm font-bold text-ink">基本情報</h2>
          <label className="mb-4 block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-secondary">マーク名</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className="h-10 w-full rounded-control border border-hairline px-3 text-sm outline-none focus:border-accent" placeholder="例：要確認" />
          </label>
          <fieldset className="mb-4">
            <legend className="mb-2 text-xs font-semibold text-ink-secondary">色</legend>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((item) => <button key={item} type="button" onClick={() => setColor(item)} aria-label={`色 ${item}`} aria-pressed={color === item} className={`h-8 w-8 rounded-full ${color === item ? 'ring-2 ring-ink ring-offset-2' : ''}`} style={{ backgroundColor: item }} />)}
            </div>
          </fieldset>
          <label className="mb-4 block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-secondary">並び順</span>
            <input type="number" min={0} value={displayOrder} onChange={(event) => setDisplayOrder(Number(event.target.value))} className="h-10 w-28 rounded-control border border-hairline px-3 text-sm outline-none focus:border-accent" />
          </label>
          <label className="flex items-center justify-between gap-3 border-t border-hairline pt-4 text-sm font-semibold text-ink">
            <span>新着時の初期値にする<small className="mt-1 block font-normal text-ink-faint">初期値は1つだけ選べます</small></span>
            <input type="checkbox" checked={isDefault} disabled={selected?.isDefault} onChange={(event) => setIsDefault(event.target.checked)} className="h-5 w-5 accent-accent" />
          </label>
          <label className="mt-4 flex items-center justify-between gap-3 border-t border-hairline pt-4 text-sm font-semibold text-ink">
            <span>
              メッセージ受信時にこのマークへ変更
              <small className="mt-1 block font-normal text-ink-faint">現在接続済みの受信時設定だけを変更します</small>
            </span>
            <input type="checkbox" checked={autoOnInbound} onChange={(event) => setAutoOnInbound(event.target.checked)} className="h-5 w-5 accent-accent" />
          </label>
        </Card>

        <Card padding="default">
          <h2 className="mb-3 text-sm font-bold text-ink">どこで使われるか</h2>
          {editing && currentUsages.length === 0 ? <p className="text-xs text-ink-faint">現在、参照している機能はありません。</p> : (
            <ul className="space-y-2 text-xs text-ink">
              {(editing ? currentUsages : ['作成後、受信箱や各機能の条件として選べます']).map((label) => <li key={label} className="flex items-start gap-2"><Circle size={6} fill="currentColor" className="mt-1 shrink-0 text-accent" aria-hidden="true" /><span>{label}</span></li>)}
            </ul>
          )}
          <p className="mt-4 text-xs leading-relaxed text-ink-faint">配信などの使用先がある間は保管できません。使用先を外すと、友だちは初期値へ移り、変更履歴は残ります。</p>
        </Card>
      </div>

      {/*
        自動変更ルール。設計 `GMvBd` は「基本情報」と同じ面に置いている。
        **別画面にすると「このマークがいつ付くのか」を見るのに行き来する。**

        **作る前は出さない。** まだ id が無いルールは保存先が無く、
        押しても何も起きない口を並べることになる（`v6-common-rules` §5-5）。
      */}
      {editing ? (
        <Card padding="default" className="mt-4">
          <SupportMarkRulesPanel accountId={selectedAccountId} markId={markId ?? null} markName={name} />
        </Card>
      ) : null}

      <StickyBar
        className="mt-4"
        status={editing ? '変更内容を確認して保存してください' : 'マーク名・色・初期値を確認してください'}
        actions={<><Button href="/tags?tab=marks">キャンセル</Button><Button type="button" variant="primary" disabled={saving || !name.trim() || (editing && !selected)} onClick={() => void save()}>{saving ? '保存中…' : editing ? '変更を保存' : '対応マークを追加'}</Button></>}
      />
    </div>
  )
}

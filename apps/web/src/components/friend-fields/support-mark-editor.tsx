'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Circle } from 'lucide-react'
import { api, type SaveSupportMarkAutomationRule, type SupportMarkAutomationEvent, type SupportMarkListItem } from '@/lib/api'
import Button from '@/components/shared/button'
import Breadcrumb from '@/components/shared/breadcrumb'
import Card from '@/components/shared/card'
import ListState from '@/components/shared/list-state'
import StickyBar from '@/components/shared/sticky-bar'
import SupportMarkRulesPanel from './support-mark-rules-panel'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { EVENT_LABELS, eventLabel } from './support-mark-rules-view'

const COLORS = [
  { value: '#EF4B55', name: '赤' },
  { value: '#B86A00', name: 'オレンジ' },
  { value: '#06C755', name: '緑' },
  { value: '#2563D4', name: '青' },
  { value: '#6B56CF', name: '紫' },
  { value: '#707981', name: 'グレー' },
] as const
const DESTINATIONS = ['受信箱の絞り込み', '友だち一覧の列と絞り込み', 'ダッシュボードの絞り込み', '配信の絞り込み条件', 'オートメーションの動作']
type MarkRow = SupportMarkListItem

export default function SupportMarkEditor({ markId }: { markId?: string }) {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const editing = Boolean(markId)
  usePageTitle(editing ? '対応マークを編集' : '対応マークを追加')

  const [items, setItems] = useState<MarkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('要確認')
  const [color, setColor] = useState<string>(COLORS[0].value)
  const [displayOrder, setDisplayOrder] = useState(4)
  const [isDefault, setIsDefault] = useState(false)
  /*
    ATTR-06: 自動変更ルールは「作るだけで有効」にしない。
    以前は初期値が true で、追加ボタンを押さなくても保存時に
    isActive=true のルールと保護時間0分が黙って送られていた。
    利用者が「＋ ルールを追加」を押したときだけ登録し、
    外す・無効化する操作を同じ場所に置く。
  */
  const [createRule, setCreateRule] = useState(false)
  const [ruleEvent, setRuleEvent] = useState<SupportMarkAutomationEvent>('staff_assigned')
  const [ruleActive, setRuleActive] = useState(true)
  const [ruleProtectionMinutes, setRuleProtectionMinutes] = useState(0)
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
        const rows = res.data
        setItems(rows)
        const current = rows.find((mark) => mark.id === markId)
        if (current) {
          setName(current.name)
          setColor(current.color)
          setDisplayOrder(current.displayOrder)
          setIsDefault(current.isDefault)
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
        ? await api.supportMarks.update(markId, selectedAccountId, { name: name.trim(), color, displayOrder, isDefault, autoOnInbound: selected?.autoOnInbound ?? false })
        : await api.supportMarks.create(selectedAccountId, {
            name: name.trim(), color, displayOrder, isDefault, autoOnInbound: false,
            automationRules: createRule ? [{ name: `${name.trim()}：${eventLabel(ruleEvent)}`, event: ruleEvent, condition: null, priority: 0, manualProtectionMinutes: ruleProtectionMinutes, isActive: ruleActive } satisfies SaveSupportMarkAutomationRule] : [],
          })
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

      {/*
        グリッド子は `min-w-0` で縮める（#973 U020）。無いと中身の
        最小幅がそのまま段の最小幅になり、狭い幅でカードの右端が切れる。
      */}
      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Card padding="default" className="min-w-0">
          <h2 className="mb-4 text-sm font-bold text-ink">基本情報</h2>
          <label className="mb-4 block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-secondary">マーク名</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className="h-10 w-full rounded-control border border-hairline px-3 text-sm outline-none focus:border-accent" placeholder="例：要確認" />
          </label>
          <fieldset className="mb-4">
            <legend className="mb-2 text-xs font-semibold text-ink-secondary">色</legend>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((item) => <button key={item.value} type="button" onClick={() => setColor(item.value)} aria-label={item.name} title={item.name} aria-pressed={color === item.value} className={`h-8 w-8 rounded-full ${color === item.value ? 'ring-2 ring-ink ring-offset-2' : ''}`} style={{ backgroundColor: item.value }} />)}
            </div>
          </fieldset>
          <label className="mb-4 block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-secondary">並び順</span>
            <input type="number" min={0} value={displayOrder} onChange={(event) => setDisplayOrder(Number(event.target.value))} className="h-10 w-28 rounded-control border border-hairline px-3 text-sm outline-none focus:border-accent" />
          </label>
          {/*
            説明文とチェックは別行にする（#973 U020）。1行に押し込むと
            狭い幅でチェック欄がカードの外へ切れる。
          */}
          <div className="border-t border-hairline pt-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input type="checkbox" checked={isDefault} disabled={selected?.isDefault} onChange={(event) => setIsDefault(event.target.checked)} className="h-5 w-5 shrink-0 accent-accent" />
              新しい友だちに最初から付ける
            </label>
            <p className="mt-1 text-xs font-normal leading-relaxed text-ink-faint">最初から付けるマークは1つだけ選べます</p>
          </div>
        </Card>

        {/* 設計 GMvBd は基本情報と自動変更を横並びで比較できる。 */}
        {editing ? (
          <Card padding="default" className="min-w-0">
            <SupportMarkRulesPanel accountId={selectedAccountId} markId={markId ?? null} markName={name} />
          </Card>
        ) : (
          <Card padding="default" className="min-w-0">
            <h2 className="mb-2 text-sm font-bold text-ink">自動変更ルール</h2>
            <p className="text-xs leading-relaxed text-ink-faint">受信・返信・担当割当・期限超過などをきっかけに自動変更できます。</p>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold text-ink-secondary">このマークを作るときに登録するルール</p>
              {createRule ? null : <Button type="button" onClick={() => setCreateRule(true)}>＋ ルールを追加</Button>}
            </div>
            {createRule ? (
              /*
                きっかけと変更先は縦に並べる（#973 U021）。横並びだと
                狭い幅で選択肢も変更先も切れる。矢印は向きを示す飾り。
                追加したあとは外せる。保存前に、いつ・何へ・どう守るかを
                このカードで確認する（ATTR-06）。
              */
              <div className="mt-3 rounded-control border border-hairline p-3 text-sm">
                <label className="block text-xs font-semibold text-ink-secondary">
                  きっかけ
                  <select aria-label="きっかけ" value={ruleEvent} onChange={(event) => setRuleEvent(event.target.value as SupportMarkAutomationEvent)} className="v6-select mt-1 h-10 w-full rounded-control border border-hairline bg-canvas px-3 text-sm font-semibold text-ink">
                    {EVENT_LABELS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <p aria-hidden="true" className="my-1 text-center text-ink-faint">↓</p>
                <p className="min-w-0 break-words rounded-control bg-surface-soft px-3 py-2.5 font-semibold text-ink">「{name || 'このマーク'}」に変更</p>
                <label className="mt-3 block text-xs font-semibold text-ink-secondary">
                  手動で変更した直後の保護
                  <select aria-label="手動変更の保護時間" value={String(ruleProtectionMinutes)} onChange={(event) => setRuleProtectionMinutes(Number(event.target.value))} className="v6-select mt-1 h-10 w-full rounded-control border border-hairline bg-canvas px-3 text-sm font-semibold text-ink">
                    <option value="0">保護しない（次のきっかけですぐ変更）</option>
                    <option value="30">30分は手動の変更を守る</option>
                    <option value="60">1時間は手動の変更を守る</option>
                    <option value="1440">1日は手動の変更を守る</option>
                  </select>
                </label>
                <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-ink">
                  <input type="checkbox" checked={ruleActive} onChange={(event) => setRuleActive(event.target.checked)} className="h-5 w-5 shrink-0 accent-accent" />
                  このルールを有効にして登録する
                </label>
                <div className="mt-3 flex justify-end">
                  <Button type="button" onClick={() => setCreateRule(false)}>ルールを外す</Button>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs leading-relaxed text-ink-faint">今は自動変更しません。必要なときだけルールを追加してください。</p>
            )}
          </Card>
        )}

        <Card padding="default" className="min-w-0">
          <h2 className="mb-3 text-sm font-bold text-ink">どこで使われるか</h2>
          <ul className="space-y-2 text-xs text-ink">
            {DESTINATIONS.map((label) => <li key={label} className="flex items-start gap-2"><Circle size={6} fill="currentColor" className="mt-1 shrink-0 text-accent" aria-hidden="true" /><span>{label}</span></li>)}
          </ul>
          {!editing ? <p className="mt-4 text-xs leading-relaxed text-ink-faint">受信箱・友だち一覧・友だち詳細のすべてに同じ順番で表示します。</p> : null}
          {editing && currentUsages.length > 0 ? <p className="mt-4 text-xs font-semibold text-ink-secondary">現在の使用先：{currentUsages.join('、')}</p> : null}
          <p className="mt-4 text-xs leading-relaxed text-ink-faint">配信などの使用先がある間は保管できません。使用先を外すと、友だちは最初から付けるマークへ移り、変更履歴は残ります。</p>
        </Card>
      </div>

      <StickyBar
        className="mt-4"
        status={editing ? '変更内容を確認して保存してください' : 'マーク名・色・初期値を確認してください'}
        actions={<><Button href="/tags?tab=marks">キャンセル</Button><Button type="button" variant="primary" disabled={saving || !name.trim() || (editing && !selected)} onClick={() => void save()}>{saving ? '保存中…' : editing ? '変更を保存' : '対応マークを追加'}</Button></>}
      />
    </div>
  )
}

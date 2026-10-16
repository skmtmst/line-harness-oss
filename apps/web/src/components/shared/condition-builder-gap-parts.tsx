'use client'

import { useEffect, useState } from 'react';
import { useAccount } from '@/contexts/account-context';
import { EntityPickerDialog } from './entity-picker';
import { Plus } from 'lucide-react';
import Select from './select';
import { type SegmentRule } from '@/lib/segment-condition';
import Button from '@/components/shared/button';
import EntitySelect, { entityOptionMetadata } from '@/components/shared/entity-select';
import { memberRanksApi } from '@/lib/api-gap3';


/**
 * 追加できる絞り込みの種類。並びは Lステップの並びに合わせてある。
 * `group` は候補の右端に出すまとまり名（友だちの情報・タグ・行動など）。
 */
const RULE_KINDS: { type: string; label: string; group: string; feature?: 'support_marks' | 'friend_fields'; make: () => SegmentRule }[] = [
  { type: 'name', label: '名前', group: '友だちの情報', make: () => ({ type: 'name', value: { text: '', targets: ['display', 'real', 'system'] } }) },
  { type: 'private_memo', label: 'メモ', group: '友だちの情報', make: () => ({ type: 'private_memo', value: '' }) },
  { type: 'status_message', label: 'ステータスメッセージ', group: '友だちの情報', make: () => ({ type: 'status_message', value: '' }) },
  { type: 'registered_at', label: '友だち登録日', group: '友だちの情報', make: () => ({ type: 'registered_at', value: { from: '', to: '' } }) },
  { type: 'support_mark', label: '対応マーク', group: 'タグ・記入欄', feature: 'support_marks' as const, make: () => ({ type: 'support_mark', value: { markIds: [], exclude: false } }) },
  { type: 'tag_exists', label: 'タグ', group: 'タグ・記入欄', make: () => ({ type: 'tag_exists', value: '' }) },
  { type: 'friend_field', label: '友だち情報', group: 'タグ・記入欄', feature: 'friend_fields' as const, make: () => ({ type: 'friend_field', value: { fieldId: '', op: 'contains', text: '' } }) },
  { type: 'scenario_subscribed', label: 'シナリオ購読', group: '参加', make: () => ({ type: 'scenario_subscribed', value: '' }) },
  { type: 'scenario_state', label: 'シナリオ', group: '参加', make: () => ({ type: 'scenario_state', value: { scenarioId: '', state: 'subscribed' } }) },
  { type: 'form_answered', label: '回答フォーム', group: '行動', make: () => ({ type: 'form_answered', value: '' }) },
  { type: 'last_reaction_at', label: '最終反応日', group: '行動', make: () => ({ type: 'last_reaction_at', value: { from: '', to: '' } }) },
  { type: 'reaction_state', label: '反応状態', group: '行動', make: () => ({ type: 'reaction_state', value: 'reply_or_postback' }) },
  { type: 'score_range', label: '行動スコア', group: '行動', make: () => ({ type: 'score_range', value: { min: 30, max: 69 } }) },
  { type: 'visit_count', label: '来店の回数', group: '来店・購入', make: () => ({ type: 'visit_count', value: { min: 1 } }) },
  { type: 'purchase_amount', label: '購入の合計金額', group: '来店・購入', make: () => ({ type: 'purchase_amount', value: { min: 1 } }) },
  { type: 'last_activity_at', label: '最後の来店・購入の日', group: '来店・購入', make: () => ({ type: 'last_activity_at', value: { from: '', to: '' } }) },
  { type: 'member_tier', label: '会員ランク', group: '来店・購入', make: () => ({ type: 'member_tier', value: '' }) },
  { type: 'is_following', label: 'ブロック状態', group: '友だちの情報', make: () => ({ type: 'is_following', value: true }) },
  { type: 'is_hidden', label: '表示状態', group: '友だちの情報', make: () => ({ type: 'is_hidden', value: false }) },
]


interface Option {
  id: string
  name: string
  color?: string | null
  groupId?: string | null
  folderId?: string | null
}


/**
 * 条件の足し口（1つ選ぶ）。共通の選ぶ窓（B-163/B-165）を使う。
 *
 * 確定したときだけ追加し、窓を閉じる。取消では条件を変えない。
 */
function KindPicker({
  kinds,
  onPick,
}: {
  kinds: typeof RULE_KINDS
  onPick: (kind: (typeof RULE_KINDS)[number]) => void
}) {
  const [open, setOpen] = useState(false)
  return <>
    <Button type="button" aria-label="追加する条件を選ぶ" onClick={() => setOpen(true)}>
      <Plus size={16} aria-hidden="true" />条件を足す
    </Button>
    {open ? <EntityPickerDialog title="条件を選ぶ" confirmLabel="条件を足す" searchPlaceholder="条件の名前で探す"
      items={kinds.map(kind => ({ id: kind.type, name: kind.label, meta: kind.group, keywords: kind.group }))}
      onConfirm={id => { const kind = kinds.find(kind => kind.type === id); if (kind) onPick(kind); setOpen(false) }}
      onCancel={() => setOpen(false)} /> : null}
  </>
}


/**
 * タグを選ぶ。
 *
 * 全部を並べるだけだと、タグが増えたときに画面が埋まる。実際の運用アカウントで
 * 101個あり、条件を1つ足すだけで縦20行のタグの壁ができて、その下にある
 * 「送る内容」まで届かなかった。Lステップも入力して絞る形にしている。
 *
 * 選んだものは常に先頭に出す。絞り込んだ状態で選ぶと、消したいときに
 * もう一度同じ言葉を打ち直さないと見つからない。
 */
function TagPicker({
  tags,
  selected, multiple, onChange
}: {
  tags: Option[];
  selected: string[]; multiple: boolean; onChange: (ids: string[]) => void
}) {
  const options = tags.map((tag) =>({...entityOptionMetadata(tag), value: tag.id, label: tag.name }))
  return multiple ?<EntitySelect kind="tag" aria-label="条件のタグ" size ="full" options={options} values={selected} onChange={onChange}/>
    : <EntitySelect kind="tag" aria-label="条件のタグ" size="full" options={[{ value: '', label: 'タグを選ぶ' }, ...options]} value={selected[0] ?? ''} onChange={(id) => onChange(id ? [id] : []
      )}/>
}



/** 会員ランクで絞る行。段の名前は、いまのアカウントのランクの段から読む（動かしていなくても選べる）。 */
function MemberTierRule({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { selectedAccountId } = useAccount()
  const [tiers, setTiers] = useState<Array<{ id: string; name: string }>>([])
  useEffect(() => {
    if (!selectedAccountId) return
    let alive = true
    memberRanksApi.program(selectedAccountId)
      .then((response) => { if (alive && response.success) setTiers(response.data.tiers.map((tier) => ({ id: tier.id, name: tier.name }))) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [selectedAccountId])
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-ink text-sm font-semibold">会員ランク</span>
      <EntitySelect aria-label="会員ランク" value={value} onChange={onChange} options={[{ value: '', label: 'ランクを選ぶ' }, ...tiers.map((tier) => ({ value: tier.id, label: `${tier.name}の人` }))]} />
    </div>
  )
}
export { RULE_KINDS, type Option, KindPicker, TagPicker, MemberTierRule }

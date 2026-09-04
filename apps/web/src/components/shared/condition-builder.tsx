'use client'

/*
 * 友だちの絞り込み条件を作る部品。
 *
 * 3か所から同じものを呼ぶ。
 *   - シナリオ全体の配信対象
 *   - 1通ごとの配信対象
 *   - アクション1つごとの実行条件
 *
 * 条件の形は worker の `SegmentCondition` と同じ。画面側で別の形にして
 * 変換すると、増やすたびに2か所直すことになり、必ずどちらかがずれる。
 *
 * 「すべて満たす」を親に置き、その下に「いずれか1つ以上を満たす」の
 * かたまりをぶら下げる形にしている。総当たりの論理式を書かせるより、
 * 運用で実際に要る形に絞ったほうが間違えにくい。
 */

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { TextField } from './text-field'
import SelectField from './select-field'
import {
  isEmptyCondition,
  pruneCondition,
  type FieldOperator,
  type SegmentCondition,
  type SegmentRule,
} from '@/lib/segment-condition'

// これまでどおりこのファイルからも取れるようにしておく。呼び出し側が多い。
export {
  isRuleComplete,
  isEmptyCondition,
  pruneCondition,
} from '@/lib/segment-condition'
export type { FieldOperator, SegmentCondition, SegmentRule } from '@/lib/segment-condition'

/** 追加できる絞り込みの種類。並びは Lステップの並びに合わせてある。 */
const RULE_KINDS: { type: string; label: string; make: () => SegmentRule }[] = [
  { type: 'name', label: '名前', make: () => ({ type: 'name', value: { text: '', targets: ['display', 'real', 'system'] } }) },
  { type: 'private_memo', label: '個別メモ', make: () => ({ type: 'private_memo', value: '' }) },
  { type: 'status_message', label: 'ステータスメッセージ', make: () => ({ type: 'status_message', value: '' }) },
  { type: 'registered_at', label: '友だち登録日', make: () => ({ type: 'registered_at', value: { from: '', to: '' } }) },
  { type: 'support_mark', label: '対応マーク', make: () => ({ type: 'support_mark', value: { markIds: [], exclude: false } }) },
  { type: 'tag_exists', label: 'タグ', make: () => ({ type: 'tag_exists', value: '' }) },
  { type: 'friend_field', label: '友だち情報', make: () => ({ type: 'friend_field', value: { fieldId: '', op: 'contains', text: '' } }) },
  { type: 'scenario_state', label: 'シナリオ', make: () => ({ type: 'scenario_state', value: { scenarioId: '', state: 'subscribed' } }) },
  { type: 'form_answered', label: '回答フォーム', make: () => ({ type: 'form_answered', value: '' }) },
  { type: 'last_reaction_at', label: '最終反応日', make: () => ({ type: 'last_reaction_at', value: { from: '', to: '' } }) },
  { type: 'reaction_state', label: '反応状態', make: () => ({ type: 'reaction_state', value: 'reply_or_postback' }) },
  { type: 'score_range', label: '行動スコア', make: () => ({ type: 'score_range', value: { min: 30, max: 69 } }) },
  { type: 'is_following', label: 'ブロック状態', make: () => ({ type: 'is_following', value: true }) },
  { type: 'is_hidden', label: '表示状態', make: () => ({ type: 'is_hidden', value: false }) },
]

const TAG_OPS: { value: string; label: string }[] = [
  { value: 'tag_exists', label: '選択したタグのいずれか1つ以上を含む人' },
  { value: 'tag_all', label: '選択したタグをすべて含む人' },
  { value: 'tag_not_exists', label: '選択したタグを1つ以上含む人を除外' },
  { value: 'tag_not_all', label: '選択したタグをすべて含む人を除外' },
]

const FIELD_OPS: { value: FieldOperator; label: string }[] = [
  { value: 'equals', label: '完全一致' },
  { value: 'contains', label: '部分一致' },
  { value: 'exists', label: '登録あり' },
  { value: 'not_exists', label: '登録なし' },
  { value: 'not_equals', label: '完全一致除外' },
  { value: 'not_contains', label: '部分一致除外' },
  { value: 'gte', label: '以上(≧)' },
  { value: 'gt', label: 'より大きい(＞)' },
  { value: 'lte', label: '以下(≦)' },
  { value: 'lt', label: 'より小さい(＜)' },
]

const REACTION_STATES: { value: string; label: string }[] = [
  { value: 'reply_or_postback', label: 'メッセージ返信・ボタン応答のある友だち' },
  { value: 'reply', label: 'メッセージ返信のある友だち' },
  { value: 'postback', label: 'ボタン応答のみある友だち' },
  { value: 'none', label: '返信・応答の無い友だち' },
]

const SCENARIO_STATES: { value: string; label: string }[] = [
  { value: 'subscribed', label: 'を購読中の人' },
  { value: 'not_subscribed', label: 'を購読していない人' },
  { value: 'completed', label: 'を読み終えた人' },
  { value: 'ever', label: 'を1度でも購読した人' },
]

interface Option {
  id: string
  name: string
}

export interface ConditionBuilderProps {
  value: SegmentCondition | null
  onChange: (next: SegmentCondition | null) => void
  /** 見出しに出す言葉。「この通の配信対象」など。 */
  label?: string
  /**
   * 該当件数を出すか。既定は出す。
   *
   * 呼び出し側が自分で人数を出している場合は消す。一斉配信の作成画面は
   * 節の右上に「送信対象 ◯人」を出していて、そちらはアカウントの絞り込みも
   * 掛かっている。並べると**違う数字が2つ**見え、どちらが送られるのか
   * 分からなくなる。
   */
  showCount?: boolean
}

export default function ConditionBuilder({ value, onChange, label, showCount = true }: ConditionBuilderProps) {
  const { selectedAccountId } = useAccount()
  const [tags, setTags] = useState<Option[]>([])
  const [fields, setFields] = useState<Option[]>([])
  const [marks, setMarks] = useState<Option[]>([])
  const [scenarios, setScenarios] = useState<Option[]>([])
  const [count, setCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)

  const condition: SegmentCondition = value ?? { operator: 'AND', rules: [], groups: [] }

  useEffect(() => {
    let cancelled = false
    if (!selectedAccountId) {
      setMarks([])
      return () => { cancelled = true }
    }
    void (async () => {
      const [tagRes, fieldRes, markRes, scenarioRes] = await Promise.all([
        api.tags.list(),
        api.friendFields.list(selectedAccountId),
        api.supportMarks.list(selectedAccountId),
        api.scenarios.list(),
      ])
      if (cancelled) return
      if (tagRes.success) setTags(tagRes.data.map((t) => ({ id: t.id, name: t.name })))
      if (fieldRes.success) setFields(fieldRes.data.map((f) => ({ id: f.id, name: f.name })))
      if (markRes.success) setMarks(markRes.data.map((m) => ({ id: m.id, name: m.name })))
      if (scenarioRes.success) setScenarios(scenarioRes.data.map((s) => ({ id: s.id, name: s.name })))
    })()
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  /*
   * 該当件数。条件を書きながら人数が見えないと、絞りすぎ・絞り足りないに
   * 気づけない。打つたびに叩くと重いので、少し待ってから数える。
   */
  useEffect(() => {
    // 出さないなら数えない。打つたびに使われない問い合わせが飛ぶ。
    if (!showCount) return
    const usable = pruneCondition(condition)
    if (!usable) {
      setCount(null)
      return
    }
    const timer = setTimeout(() => {
      void (async () => {
        setCounting(true)
        try {
          const res = await api.segments.count(usable as never)
          setCount(res.success ? (res.count ?? 0) : null)
        } catch {
          setCount(null)
        } finally {
          setCounting(false)
        }
      })()
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(condition), showCount])

  const update = (next: SegmentCondition) => {
    onChange(isEmptyCondition(next) ? null : next)
  }

  const addRule = (kind: (typeof RULE_KINDS)[number], groupIndex: number | null) => {
    if (groupIndex === null) {
      update({ ...condition, rules: [...condition.rules, kind.make()] })
      return
    }
    const groups = [...(condition.groups ?? [])]
    groups[groupIndex] = { ...groups[groupIndex], rules: [...groups[groupIndex].rules, kind.make()] }
    update({ ...condition, groups })
  }

  const setRule = (index: number, rule: SegmentRule, groupIndex: number | null) => {
    if (groupIndex === null) {
      const rules = [...condition.rules]
      rules[index] = rule
      update({ ...condition, rules })
      return
    }
    const groups = [...(condition.groups ?? [])]
    const rules = [...groups[groupIndex].rules]
    rules[index] = rule
    groups[groupIndex] = { ...groups[groupIndex], rules }
    update({ ...condition, groups })
  }

  const removeRule = (index: number, groupIndex: number | null) => {
    if (groupIndex === null) {
      update({ ...condition, rules: condition.rules.filter((_, i) => i !== index) })
      return
    }
    const groups = [...(condition.groups ?? [])]
    groups[groupIndex] = {
      ...groups[groupIndex],
      rules: groups[groupIndex].rules.filter((_, i) => i !== index),
    }
    update({ ...condition, groups })
  }

  const renderRules = (rules: SegmentRule[], groupIndex: number | null) => (
    <div className="space-y-2">
      {rules.map((rule, i) => (
        <div
          key={`${groupIndex ?? 'root'}-${i}`}
          className="border-hairline bg-canvas rounded-card flex flex-wrap items-start gap-2 border p-3"
        >
          <button
            type="button"
            onClick={() => removeRule(i, groupIndex)}
            className="text-ink-faint hover:text-danger rounded-control border-hairline h-9 shrink-0 border px-2 text-xs"
            aria-label="この条件を外す"
          >
            外す
          </button>
          <div className="min-w-0 flex-1 space-y-2">
            <RuleEditor
              rule={rule}
              onChange={(next) => setRule(i, next, groupIndex)}
              tags={tags}
              fields={fields}
              marks={marks}
              scenarios={scenarios}
            />
          </div>
        </div>
      ))}
    </div>
  )

  const kindButtons = (groupIndex: number | null) => (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {RULE_KINDS.map((kind) => (
        <button
          key={kind.type}
          type="button"
          onClick={() => addRule(kind, groupIndex)}
          className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-9 border px-3 text-xs"
        >
          {kind.label}
        </button>
      ))}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="border-hairline rounded-card border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-ink text-sm font-bold">
            「すべて満たす」必要がある条件<span className="text-ink-faint ml-1 font-normal">(and条件)</span>
          </p>
          {label && <span className="text-ink-faint text-xs">{label}</span>}
        </div>
        <div className="mt-3">{renderRules(condition.rules, null)}</div>
        <p className="text-ink-faint mt-3 text-center text-xs">絞り込む項目を更に追加できます</p>
        {kindButtons(null)}
      </div>

      {(condition.groups ?? []).map((group, gi) => (
        <div key={gi} className="border-hairline rounded-card border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-ink text-sm font-bold">
              「いずれか1つ以上を満たす」必要がある条件
              <span className="text-ink-faint ml-1 font-normal">(or条件)</span>
            </p>
            <button
              type="button"
              onClick={() =>
                update({ ...condition, groups: (condition.groups ?? []).filter((_, i) => i !== gi) })
              }
              className="text-ink-faint hover:text-danger rounded-control border-hairline h-9 border px-3 text-xs"
            >
              このかたまりを外す
            </button>
          </div>
          <div className="mt-3">{renderRules(group.rules, gi)}</div>
          {kindButtons(gi)}
        </div>
      ))}

      <button
        type="button"
        onClick={() =>
          update({
            ...condition,
            groups: [...(condition.groups ?? []), { operator: 'OR', rules: [] }],
          })
        }
        className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-card h-10 w-full border border-dashed text-sm"
      >
        ＋「いずれか1つ以上を満たす」必要がある条件(or条件)を追加
      </button>

      {showCount && (
        <div className="bg-canvas-sunken rounded-card flex items-baseline justify-between px-4 py-3">
          <span className="text-ink-secondary text-xs">該当件数</span>
          <span className="text-ink text-lg font-bold tabular-nums">
            {isEmptyCondition(condition)
              ? '絞り込みなし'
              : !pruneCondition(condition)
                ? '入力するとここに出ます'
                : counting
                  ? '…'
                  : count === null
                    ? '—'
                    : `${count.toLocaleString('ja-JP')} 人`}
          </span>
        </div>
      )}
    </div>
  )
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
  selected,
  onToggle,
}: {
  tags: Option[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)

  if (tags.length === 0) {
    return <span className="text-ink-faint text-xs">タグがまだありません</span>
  }

  const chosen = tags.filter((t) => selected.includes(t.id))
  const rest = tags.filter(
    (t) => !selected.includes(t.id) && (query === '' || t.name.includes(query)),
  )
  // 打っていないときだけ畳む。絞り込んだ結果を隠すと、探しているものが出ない。
  const LIMIT = 24
  const collapsed = query === '' && !showAll && rest.length > LIMIT
  const shown = collapsed ? rest.slice(0, LIMIT) : rest

  const chip = (tag: Option, on: boolean) => (
    <button
      key={tag.id}
      type="button"
      onClick={() => onToggle(tag.id)}
      className={`rounded-pill h-8 px-3 text-xs transition-colors ${
        on ? 'bg-accent-deep text-on-accent' : 'border-hairline text-ink-secondary hover:bg-canvas-sunken border'
      }`}
    >
      {tag.name}
    </button>
  )

  return (
    <div className="space-y-2">
      {tags.length > LIMIT && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`タグ名で絞り込む（${tags.length}件）`}
          aria-label="タグ名で絞り込む"
          className="border-hairline rounded-control h-9 w-full border px-3 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-status-info sm:max-w-xs"
        />
      )}
      <div className="flex flex-wrap gap-1.5">
        {chosen.map((tag) => chip(tag, true))}
        {shown.map((tag) => chip(tag, false))}
      </div>
      {collapsed && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-ink-secondary hover:bg-canvas-sunken border-hairline rounded-control h-8 border px-3 text-xs"
        >
          残り {rest.length - LIMIT} 件を表示
        </button>
      )}
      {query !== '' && rest.length === 0 && chosen.length === 0 && (
        <p className="text-ink-faint text-xs">「{query}」に当てはまるタグがありません</p>
      )}
    </div>
  )
}

interface RuleEditorProps {
  rule: SegmentRule
  onChange: (next: SegmentRule) => void
  tags: Option[]
  fields: Option[]
  marks: Option[]
  scenarios: Option[]
}

const selectClass =
  'border-hairline rounded-control text-ink h-9 border bg-white px-2 text-sm min-w-0'
const inputClass =
  'border-hairline rounded-control text-ink h-9 border px-3 text-sm min-w-0 flex-1'

function RuleEditor({ rule, onChange, tags, fields, marks, scenarios }: RuleEditorProps) {
  const v = rule.value as Record<string, unknown>

  // タグは4つの演算子で type そのものが変わる。1つの行として扱う。
  if (rule.type.startsWith('tag_')) {
    const selected = Array.isArray(rule.value)
      ? (rule.value as string[])
      : typeof rule.value === 'string' && rule.value
        ? [rule.value]
        : []
    const isMulti = rule.type === 'tag_all' || rule.type === 'tag_not_all'
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink text-sm font-medium">タグ</span>
          <SelectField
            aria-label="タグの条件"
            value={rule.type}
            onChange={(e) => {
              const nextType = e.target.value
              const nextMulti = nextType === 'tag_all' || nextType === 'tag_not_all'
              onChange({
                type: nextType,
                value: nextMulti ? selected : (selected[0] ?? ''),
              })
            }}
            options={TAG_OPS.map((op) => ({ value: op.value, label: op.label }))}
            className={selectClass}
          />
        </div>
        <TagPicker
          tags={tags}
          selected={selected}
          onToggle={(id) => {
            const next = selected.includes(id) ? selected.filter((t) => t !== id) : [...selected, id]
            onChange({ type: rule.type, value: isMulti ? next : (next[next.length - 1] ?? '') })
          }}
        />
      </>
    )
  }

  switch (rule.type) {
    case 'name':
      return (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink text-sm font-medium">名前</span>
            <input
              value={String(v.text ?? '')}
              onChange={(e) => onChange({ type: rule.type, value: { ...v, text: e.target.value } })}
              placeholder="半角スペースで区切るといずれかに一致"
              className={inputClass}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            {[
              { key: 'display', label: 'LINE登録名' },
              { key: 'real', label: '本名' },
              { key: 'system', label: 'システム表示名' },
            ].map((t) => {
              const targets = Array.isArray(v.targets) ? (v.targets as string[]) : []
              return (
                <label key={t.key} className="text-ink-secondary flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={targets.includes(t.key)}
                    onChange={(e) =>
                      onChange({
                        type: rule.type,
                        value: {
                          ...v,
                          targets: e.target.checked
                            ? [...targets, t.key]
                            : targets.filter((x) => x !== t.key),
                        },
                      })
                    }
                  />
                  {t.label}
                </label>
              )
            })}
            <span className="text-ink-faint text-xs">から検索</span>
          </div>
        </>
      )

    case 'private_memo':
    case 'status_message':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink text-sm font-medium">
            {rule.type === 'private_memo' ? '個別メモ' : 'ステータスメッセージ'}
          </span>
          <input
            value={String(rule.value ?? '')}
            onChange={(e) => onChange({ type: rule.type, value: e.target.value })}
            className={inputClass}
          />
        </div>
      )

    case 'registered_at':
    case 'last_reaction_at':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink text-sm font-medium">
            {rule.type === 'registered_at' ? '友だち登録日' : '最終反応日'}
          </span>
          <input
            type="date"
            value={String(v.from ?? '')}
            onChange={(e) => onChange({ type: rule.type, value: { ...v, from: e.target.value } })}
            className={selectClass}
          />
          <span className="text-ink-faint text-sm">〜</span>
          <input
            type="date"
            value={String(v.to ?? '')}
            onChange={(e) => onChange({ type: rule.type, value: { ...v, to: e.target.value } })}
            className={selectClass}
          />
        </div>
      )

    case 'support_mark': {
      const selected = Array.isArray(v.markIds) ? (v.markIds as string[]) : []
      return (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink text-sm font-medium">対応マーク</span>
            <SelectField
              aria-label="マークの含め方"
              value={v.exclude ? 'exclude' : 'include'}
              onChange={(e) =>
                onChange({ type: rule.type, value: { ...v, exclude: e.target.value === 'exclude' } })
              }
              options={[
                { value: 'include', label: '選択したマークのいずれかに一致' },
                { value: 'exclude', label: '選択したマークを除外' },
              ]}
              className={selectClass}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {marks.map((mark) => {
              const on = selected.includes(mark.id)
              return (
                <button
                  key={mark.id}
                  type="button"
                  onClick={() =>
                    onChange({
                      type: rule.type,
                      value: {
                        ...v,
                        markIds: on ? selected.filter((id) => id !== mark.id) : [...selected, mark.id],
                      },
                    })
                  }
                  className={`rounded-pill h-8 px-3 text-xs transition-colors ${
                    on ? 'bg-accent-deep text-on-accent' : 'border-hairline text-ink-secondary border'
                  }`}
                >
                  {mark.name}
                </button>
              )
            })}
          </div>
        </>
      )
    }

    case 'friend_field': {
      const op = String(v.op ?? 'contains') as FieldOperator
      const needsText = op !== 'exists' && op !== 'not_exists'
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink text-sm font-medium">友だち情報</span>
          <SelectField
            aria-label="友だち情報の項目"
            value={String(v.fieldId ?? '')}
            onChange={(e) => onChange({ type: rule.type, value: { ...v, fieldId: e.target.value } })}
            options={[{ value: '', label: '項目を選ぶ' }, ...fields.map((f) => ({ value: f.id, label: f.name }))]}
            className={selectClass}
          />
          <SelectField
            aria-label="項目の比べ方"
            value={op}
            onChange={(e) => onChange({ type: rule.type, value: { ...v, op: e.target.value } })}
            options={FIELD_OPS.map((o) => ({ value: o.value, label: o.label }))}
            className={selectClass}
          />
          {needsText && (
            <input
              value={String(v.text ?? '')}
              onChange={(e) => onChange({ type: rule.type, value: { ...v, text: e.target.value } })}
              className={inputClass}
            />
          )}
        </div>
      )
    }

    case 'scenario_state':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink text-sm font-medium">シナリオ</span>
          <SelectField
            aria-label="シナリオ"
            value={String(v.scenarioId ?? '')}
            onChange={(e) => onChange({ type: rule.type, value: { ...v, scenarioId: e.target.value } })}
            options={[{ value: '', label: 'シナリオを選ぶ' }, ...scenarios.map((sc) => ({ value: sc.id, label: sc.name }))]}
            className={selectClass}
          />
          <SelectField
            aria-label="シナリオの状態"
            value={String(v.state ?? 'subscribed')}
            onChange={(e) => onChange({ type: rule.type, value: { ...v, state: e.target.value } })}
            options={SCENARIO_STATES.map((st) => ({ value: st.value, label: st.label }))}
            className={selectClass}
          />
        </div>
      )

    case 'form_answered':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink text-sm font-medium">回答フォーム</span>
          <input
            value={String(rule.value ?? '')}
            onChange={(e) => onChange({ type: rule.type, value: e.target.value })}
            placeholder="フォームID（空ならどれかに回答した人）"
            className={inputClass}
          />
        </div>
      )

    case 'reaction_state':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink text-sm font-medium">反応状態</span>
          <SelectField
            aria-label="反応の種類"
            value={String(rule.value ?? 'reply_or_postback')}
            onChange={(e) => onChange({ type: rule.type, value: e.target.value })}
            options={REACTION_STATES.map((st) => ({ value: st.value, label: st.label }))}
            className={selectClass}
          />
        </div>
      )

    case 'score_range':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink text-sm font-medium">行動スコア</span>
          <TextField
            type="number"
            step={1}
            value={typeof v.min === 'number' ? v.min : ''}
            onChange={(e) => onChange({ type: rule.type, value: { ...v, min: e.target.value === '' ? null : Number(e.target.value) } })}
            placeholder="下限なし"
          />
          <span className="text-ink-faint text-sm">点以上〜</span>
          <TextField
            type="number"
            step={1}
            value={typeof v.max === 'number' ? v.max : ''}
            onChange={(e) => onChange({ type: rule.type, value: { ...v, max: e.target.value === '' ? null : Number(e.target.value) } })}
            placeholder="上限なし"
          />
          <span className="text-ink-faint text-sm">点以下</span>
        </div>
      )

    case 'is_following':
    case 'is_hidden':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink text-sm font-medium">
            {rule.type === 'is_following' ? 'ブロック状態' : '表示状態'}
          </span>
          <SelectField
            aria-label={rule.type === 'is_following' ? '友だちの状態' : '一覧での表示'}
            value={rule.value === true ? 'true' : 'false'}
            onChange={(e) => onChange({ type: rule.type, value: e.target.value === 'true' })}
            options={rule.type === 'is_following'
              ? [
                { value: 'true', label: '友だちのまま（ブロックしていない）' },
                { value: 'false', label: 'ブロック中' },
              ]
              : [
                { value: 'false', label: '表示中の友だち' },
                { value: 'true', label: '非表示にした友だち' },
              ]}
            className={selectClass}
          />
        </div>
      )

    default:
      return <span className="text-ink-faint text-xs">この条件はこの画面では編集できません（{rule.type}）</span>
  }
}

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

export type FieldOperator =
  | 'equals'
  | 'contains'
  | 'exists'
  | 'not_exists'
  | 'not_equals'
  | 'not_contains'
  | 'gte'
  | 'gt'
  | 'lte'
  | 'lt'

export interface SegmentRule {
  type: string
  value: unknown
}

export interface SegmentCondition {
  operator: 'AND' | 'OR'
  rules: SegmentRule[]
  groups?: SegmentCondition[]
}

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
  { type: 'is_following', label: 'ブロック状態', make: () => ({ type: 'is_following', value: true }) },
  { type: 'is_hidden', label: '表示状態', make: () => ({ type: 'is_hidden', value: false }) },
]

const TAG_OPS: { value: string; label: string }[] = [
  { value: 'tag_exists', label: '選択したタグのいずれか1つ以上を含む人' },
  { value: 'tag_all', label: '選択したタグを全て含む人' },
  { value: 'tag_not_exists', label: '選択したタグを1つ以上含む人を除外' },
  { value: 'tag_not_all', label: '選択したタグを全て含む人を除外' },
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
}

/**
 * まだ書きかけの行か。
 *
 * タグを選ぶ前、項目を選ぶ前の行を数え上げに送ると、worker が
 * 「読めない条件」として断る。件数が出ないだけならまだしも、そのまま
 * 保存すると**誰にも届かない条件**が出来上がる。書けている行だけを使う。
 */
export function isRuleComplete(rule: SegmentRule): boolean {
  const v = rule.value as Record<string, unknown>
  switch (rule.type) {
    case 'tag_exists':
    case 'tag_not_exists':
      return typeof rule.value === 'string' && rule.value !== ''
    case 'tag_all':
    case 'tag_not_all':
      return Array.isArray(rule.value) && rule.value.length > 0
    case 'name':
      return typeof v?.text === 'string' && v.text.trim() !== ''
    case 'private_memo':
    case 'status_message':
    case 'ref_code':
      return typeof rule.value === 'string' && rule.value.trim() !== ''
    case 'registered_at':
    case 'last_reaction_at':
      return (
        (typeof v?.from === 'string' && v.from !== '') ||
        (typeof v?.to === 'string' && v.to !== '')
      )
    case 'support_mark':
      return Array.isArray(v?.markIds) && (v.markIds as unknown[]).length > 0
    case 'friend_field':
      return typeof v?.fieldId === 'string' && v.fieldId !== ''
    case 'scenario_state':
      return typeof v?.scenarioId === 'string' && v.scenarioId !== ''
    default:
      // form_answered は空で「どれかに回答した人」、is_following /
      // is_hidden / reaction_state は常に値が入っている。
      return true
  }
}

/** 書きかけの行を落とす。保存にも数え上げにも同じものを使う。 */
export function pruneCondition(condition: SegmentCondition | null): SegmentCondition | null {
  if (!condition) return null
  const rules = (condition.rules ?? []).filter(isRuleComplete)
  const groups = (condition.groups ?? [])
    .map((g) => pruneCondition(g))
    .filter((g): g is SegmentCondition => g !== null)
  if (rules.length === 0 && groups.length === 0) return null
  return { operator: condition.operator, rules, groups }
}

/** 条件が実質空か。空なら null として保存し、「絞り込みなし」の意味にする。 */
export function isEmptyCondition(condition: SegmentCondition | null): boolean {
  if (!condition) return true
  const groupCount = (condition.groups ?? []).filter(
    (g) => g.rules.length > 0 || (g.groups?.length ?? 0) > 0,
  ).length
  return condition.rules.length === 0 && groupCount === 0
}

export default function ConditionBuilder({ value, onChange, label }: ConditionBuilderProps) {
  const [tags, setTags] = useState<Option[]>([])
  const [fields, setFields] = useState<Option[]>([])
  const [marks, setMarks] = useState<Option[]>([])
  const [scenarios, setScenarios] = useState<Option[]>([])
  const [count, setCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)

  const condition: SegmentCondition = value ?? { operator: 'AND', rules: [], groups: [] }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [tagRes, fieldRes, markRes, scenarioRes] = await Promise.all([
        api.tags.list(),
        api.friendFields.list(),
        api.supportMarks.list(),
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
  }, [])

  /*
   * 該当件数。条件を書きながら人数が見えないと、絞りすぎ・絞り足りないに
   * 気づけない。打つたびに叩くと重いので、少し待ってから数える。
   */
  useEffect(() => {
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
  }, [JSON.stringify(condition)])

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
          <select
            value={rule.type}
            onChange={(e) => {
              const nextType = e.target.value
              const nextMulti = nextType === 'tag_all' || nextType === 'tag_not_all'
              onChange({
                type: nextType,
                value: nextMulti ? selected : (selected[0] ?? ''),
              })
            }}
            className={selectClass}
          >
            {TAG_OPS.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => {
            const on = selected.includes(tag.id)
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => {
                  const next = on ? selected.filter((id) => id !== tag.id) : [...selected, tag.id]
                  onChange({ type: rule.type, value: isMulti ? next : (next[next.length - 1] ?? '') })
                }}
                className={`rounded-pill h-8 px-3 text-xs transition-colors ${
                  on ? 'bg-accent text-on-accent' : 'border-hairline text-ink-secondary border'
                }`}
              >
                {tag.name}
              </button>
            )
          })}
          {tags.length === 0 && <span className="text-ink-faint text-xs">タグがまだありません</span>}
        </div>
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
            <select
              value={v.exclude ? 'exclude' : 'include'}
              onChange={(e) =>
                onChange({ type: rule.type, value: { ...v, exclude: e.target.value === 'exclude' } })
              }
              className={selectClass}
            >
              <option value="include">選択したマークのいずれかに一致</option>
              <option value="exclude">選択したマークを除外</option>
            </select>
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
                    on ? 'bg-accent text-on-accent' : 'border-hairline text-ink-secondary border'
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
          <select
            value={String(v.fieldId ?? '')}
            onChange={(e) => onChange({ type: rule.type, value: { ...v, fieldId: e.target.value } })}
            className={selectClass}
          >
            <option value="">項目を選ぶ</option>
            {fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <select
            value={op}
            onChange={(e) => onChange({ type: rule.type, value: { ...v, op: e.target.value } })}
            className={selectClass}
          >
            {FIELD_OPS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
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
          <select
            value={String(v.scenarioId ?? '')}
            onChange={(e) => onChange({ type: rule.type, value: { ...v, scenarioId: e.target.value } })}
            className={selectClass}
          >
            <option value="">シナリオを選ぶ</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            value={String(v.state ?? 'subscribed')}
            onChange={(e) => onChange({ type: rule.type, value: { ...v, state: e.target.value } })}
            className={selectClass}
          >
            {SCENARIO_STATES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
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
          <select
            value={String(rule.value ?? 'reply_or_postback')}
            onChange={(e) => onChange({ type: rule.type, value: e.target.value })}
            className={selectClass}
          >
            {REACTION_STATES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      )

    case 'is_following':
    case 'is_hidden':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink text-sm font-medium">
            {rule.type === 'is_following' ? 'ブロック状態' : '表示状態'}
          </span>
          <select
            value={rule.value === true ? 'true' : 'false'}
            onChange={(e) => onChange({ type: rule.type, value: e.target.value === 'true' })}
            className={selectClass}
          >
            {rule.type === 'is_following' ? (
              <>
                <option value="true">友だちのまま（ブロックしていない）</option>
                <option value="false">ブロック中</option>
              </>
            ) : (
              <>
                <option value="false">表示中の友だち</option>
                <option value="true">非表示にした友だち</option>
              </>
            )}
          </select>
        </div>
      )

    default:
      return <span className="text-ink-faint text-xs">この条件はこの画面では編集できません（{rule.type}）</span>
  }
}

'use client'

/*
 * ★V8 保存した検索の編集（Pencil `AqDWN`）。
 *
 * v7（tags/searches/edit/page.tsx）と動きは同じで、置き場だけを
 * V8 の絵へ合わせる。段は「名前と共有」「条件」「友だち一覧での
 * 見せ方」、右の欄に「当てはまる人」（人数・数えた時刻・数え直す・
 * 当てはまる人を見る）。追従バーは削除＝左端、キャンセル・複製・
 * 保存＝真ん中（オーナー決定 2026-10-01）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import {
  isSavedSearchOpAllowed,
  isSavedSearchValueOptionalOp,
} from '@line-crm/shared'
import type {
  FriendField,
  SavedSearch,
  SavedSearchCondition,
  SavedSearchConditionKind,
  SavedSearchConditions,
  Scenario,
  SupportMark,
  Tag,
} from '@line-crm/shared'
import { api, ApiError, type SavedSearchDetail, type SavedSearchMatchPreview } from '@/lib/api'
import { createResponseGate } from '@/lib/latest-request'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import StickyBar from '@/components/shared/sticky-bar'
import TargetMissing from '@/components/shared/target-missing'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { TextInput } from '@/components/shared/form-controls'
import DateField from '@/components/shared/date-field'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Select from '@/components/shared/select'
import { optionsWithCurrent } from '@/app/tags/searches/edit/reference-options'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { savedSearchSummary, type SavedSearchConditionLabels } from '@/components/friends/saved-search-utils'
import MetricValue from '@/components/ui/metric-value'
import { AttributeKindGuide, DuplicateNameNote, findDuplicateNames } from '@/components/friend-fields/attribute-kind-guide'
import { formatDateTime } from '@/lib/format'
import styles from './search-editor-v8.module.css'

/*
 * R185: 友だち画面で作れる条件はここでも編集できるようにする。実行側
 * （saved-search-filter）が解釈できる種類はすべて並べ、知らない種類を
 * 先頭の「タグ」へ置換表示しない。回答フォーム・購入履歴は実行できる
 * ので「未接続」として削除を迫らない。
 */
const EDITABLE_KINDS: Array<{ value: SavedSearchConditionKind; label: string }> = [
  { value: 'tag', label: 'タグ' },
  { value: 'name', label: '名前' },
  { value: 'field', label: '友だち情報' },
  { value: 'status_message', label: 'ステータスメッセージ' },
  { value: 'mark', label: '対応マーク' },
  { value: 'scenario', label: 'シナリオ' },
  { value: 'assignee', label: '担当者' },
  { value: 'event_booking', label: 'イベント予約' },
  { value: 'calendar_booking', label: 'カレンダー予約' },
  { value: 'form', label: '回答フォーム' },
  { value: 'purchase', label: '購入履歴' },
  { value: 'last_activity', label: '最終反応日' },
  { value: 'reminder', label: 'リマインダ' },
  { value: 'memo', label: '個別メモ' },
  { value: 'common_event', label: 'その他のイベント' },
  { value: 'chat_status', label: '対応状況' },
  { value: 'following', label: '友だち状態' },
  { value: 'created_at', label: '友だち追加日' },
]

/** 存在確認だけの種類（値が無くても「ある／ない」が成立する）。 */
const EXISTENCE_KINDS = new Set<SavedSearchConditionKind>([
  'event_booking', 'calendar_booking', 'form', 'purchase', 'reminder',
])

/** 日付の範囲・前後で絞る種類。 */
const DATE_RANGE_KINDS = new Set<SavedSearchConditionKind>(['created_at', 'last_activity'])

/*
 * R185: 保存済みの旧表記（has/eq 等）を画面の主表記へ寄せる。
 * 実行側は両方を同じ意味で解釈するため、付け替えで意味は変わらない。
 */
function canonicalExistenceOp(op: string): 'exists' | 'not_exists' {
  return ['not_exists', 'not_has', 'ne'].includes(op) ? 'not_exists' : 'exists'
}

function dateRangeOf(condition: SavedSearchCondition): { from: string; to: string } {
  if (condition.value && typeof condition.value === 'object') {
    const range = condition.value as { from?: unknown; to?: unknown }
    return {
      from: typeof range.from === 'string' ? range.from : '',
      to: typeof range.to === 'string' ? range.to : '',
    }
  }
  const single = typeof condition.value === 'string' ? condition.value : ''
  if (condition.op === 'before') return { from: '', to: single }
  return { from: single, to: '' }
}
const USAGE_KIND_LABELS = {
  broadcast: '一斉配信',
  automation: 'オートメーション',
  scenario: 'シナリオ',
  other: 'そのほか',
} as const

/*
  保存前の検査は実行側と同じ演算子表で合わせる（ATTR-13）。
  ここを通るのに実行で断られる組み合わせがあると、保存した本人が
  画面を離れたあとに検索が壊れる。
*/
function conditionProblem(condition: SavedSearchCondition): string | null {
  if (!isSavedSearchOpAllowed(condition.kind, condition.op)) {
    return `${EDITABLE_KINDS.find((item) => item.value === condition.kind)?.label ?? '条件'}では使えない比較方法です`
  }
  if (condition.kind === 'following') return typeof condition.value === 'boolean' ? null : '友だち状態を選んでください'
  if (DATE_RANGE_KINDS.has(condition.kind)) {
    const label = condition.kind === 'last_activity' ? '最終反応日' : '友だち追加日'
    const { from, to } = dateRangeOf(condition)
    if (!from && !to) return `${label}を入力してください`
    /* R183: 逆転期間は0人として扱わず、保存の前に断る。片側だけは許す。 */
    if (from && to && from > to) return '期間の開始日が終了日より後になっています'
    return null
  }
  if (condition.kind === 'field' && !condition.key?.trim()) return '友だち情報の項目名を入力してください'
  /*
    「登録あり／なし」は値を取らない。値の必須チェックへ落とさない。
    友だち画面で作った存在確認（予約・回答・リマインダ等）は値なしで
    保存されるため、実行側が値を要らない種類だけ値なしを許す（R185）。
    タグ等の値は引き続き必須（空で保存すると実行時に止まる）。
  */
  if ((condition.kind === 'field' || condition.kind === 'memo' || EXISTENCE_KINDS.has(condition.kind))
    && isSavedSearchValueOptionalOp(condition.op)) return null
  if (condition.kind === 'common_event' && !(typeof condition.value === 'string' && condition.value.trim())) {
    return 'その他のイベントの種類を入力してください'
  }
  return typeof condition.value === 'string' && condition.value.trim()
    ? null
    : `${EDITABLE_KINDS.find((item) => item.value === condition.kind)?.label ?? '条件'}の値を選んでください`
}

function defaultCondition(tags: Tag[]): SavedSearchCondition {
  return { kind: 'tag', op: 'includes', value: tags[0]?.id ?? '' }
}

function normalizeForEdit(search: SavedSearch): SavedSearchConditions {
  return {
    ...search.conditions,
    all: [...(search.conditions.all ?? [])],
    any: [...(search.conditions.any ?? [])],
    list: {
      columns: search.conditions.list?.columns ?? ['名前', 'タグ', '担当者'],
      sort: search.conditions.list?.sort ?? 'recent',
      limit: search.conditions.list?.limit ?? 20,
    },
  }
}

/*
 * R185: 日付の範囲・前後を1つの編集欄で扱う。友だち画面は「以降」
 * （after＋日付1つ）で保存するため、文字列の値も範囲へ読み替える。
 * R183: 逆転期間は欄の下で知らせる（保存前の検査でも断る）。
 */
function DateRangeEditor({
  condition,
  onChange,
}: {
  condition: SavedSearchCondition
  onChange: (next: SavedSearchCondition) => void
}) {
  const { from, to } = dateRangeOf(condition)
  const op = condition.op === 'after' || condition.op === 'before' ? condition.op : 'between'
  const setOp = (next: string) => {
    if (next === 'after') onChange({ ...condition, op: 'after', value: from || to })
    else if (next === 'before') onChange({ ...condition, op: 'before', value: to || from })
    else onChange({ ...condition, op: 'between', value: { from, to } })
  }
  const setFrom = (v: string) => {
    if (op === 'after') onChange({ ...condition, op: 'after', value: v })
    else if (op === 'before') onChange({ ...condition, op: 'between', value: { from: v, to } })
    else onChange({ ...condition, op: 'between', value: { from: v, to } })
  }
  const setTo = (v: string) => {
    if (op === 'before') onChange({ ...condition, op: 'before', value: v })
    else if (op === 'after') onChange({ ...condition, op: 'between', value: { from, to: v } })
    else onChange({ ...condition, op: 'between', value: { from, to: v } })
  }
  const reversed = Boolean(from && to && from > to)
  return (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        <Select
          aria-label="日付の比べ方"
          value={op}
          onChange={setOp}
          options={[
            { value: 'between', label: '期間' },
            { value: 'after', label: '以降' },
            { value: 'before', label: '以前' },
          ]}
          className="w-28"
        />
        <label className="min-w-40 flex-1 text-xs font-semibold text-ink-faint">
          {op === 'before' ? '終了日' : '開始日'}
          <DateField aria-label={op === 'before' ? '終了日' : '開始日'} value={op === 'before' ? to : from} onChange={op === 'before' ? setTo : setFrom} className="mt-1" />
        </label>
        {op === 'between' ? (
          <>
            <span className="pb-2 text-ink-faint" aria-hidden="true">〜</span>
            <label className="min-w-40 flex-1 text-xs font-semibold text-ink-faint">
              終了日
              <DateField aria-label="終了日" value={to} onChange={setTo} className="mt-1" />
            </label>
          </>
        ) : null}
      </div>
      {reversed ? (
        <p role="alert" className="mt-1 text-xs text-danger">開始日が終了日より後になっています。入れ替えてください。</p>
      ) : null}
    </div>
  )
}

/** ★V8: 条件の中身の選ぶ欄・値。行の外に「かつ／または」と × を置く。 */
function ConditionControls({
  condition,
  tags,
  marks,
  scenarios,
  fields,
  forms,
  operators,
  referenceErrors,
  onChange,
}: {
  condition: SavedSearchCondition
  tags: Tag[]
  marks: SupportMark[]
  scenarios: Scenario[]
  fields: FriendField[]
  forms: Array<{ id: string; name: string }>
  operators: Array<{ id: string; name: string }>
  referenceErrors: { marks: boolean; scenarios: boolean; fields: boolean; forms: boolean; operators: boolean }
  onChange: (next: SavedSearchCondition) => void
}) {
  const changeKind = (kind: SavedSearchConditionKind) => {
    if (kind === 'tag') onChange({ kind, op: 'includes', value: tags[0]?.id ?? '' })
    else if (kind === 'field') onChange({ kind, key: fields[0]?.fieldKey ?? '', op: 'eq', value: '' })
    else if (kind === 'mark') onChange({ kind, op: 'eq', value: marks[0]?.id ?? '' })
    else if (kind === 'scenario') onChange({ kind, op: 'eq', value: scenarios[0]?.id ?? '' })
    else if (kind === 'assignee') onChange({ kind, op: 'eq', value: operators[0]?.id ?? '' })
    else if (kind === 'form') onChange({ kind, op: 'exists', value: '' })
    else if (kind === 'following') onChange({ kind, op: 'eq', value: true })
    else if (kind === 'memo') onChange({ kind, op: 'exists', value: '' })
    else if (kind === 'common_event') onChange({ kind, op: 'exists', value: '' })
    else if (EXISTENCE_KINDS.has(kind)) onChange({ kind, op: 'exists', value: '' })
    else if (DATE_RANGE_KINDS.has(kind)) onChange({ kind, op: 'between', value: { from: '', to: '' } })
    else onChange({ kind, op: kind === 'name' || kind === 'status_message' ? 'contains' : 'eq', value: '' })
  }
  const rawValue = typeof condition.value === 'string' ? condition.value : ''

  return (
    <>
      <Select aria-label="条件の種類" value={EDITABLE_KINDS.some((item) => item.value === condition.kind) ? condition.kind : ''} onChange={(value) => changeKind(value as SavedSearchConditionKind)} options={[{ value: '', label: '種類を選ぶ', disabled: true }, ...EDITABLE_KINDS]} className="w-36" />

      {condition.kind === 'tag' ? (
        <>
          <Select aria-label="タグの比較" value={condition.op} onChange={(op) => onChange({ ...condition, op })} options={[{ value: 'includes', label: '次を含む' }, { value: 'excludes', label: '次を含まない' }]} className="w-32" />
          <Select aria-label="タグ" value={rawValue} onChange={(value) => onChange({ ...condition, value })} options={[{ value: '', label: 'タグを選ぶ' }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]} className="min-w-44 flex-1" />
        </>
      ) : condition.kind === 'field' ? (
        <>
          <Select
            aria-label="友だち情報の項目"
            value={condition.key ?? ''}
            disabled={referenceErrors.fields}
            onChange={(key) => onChange({ ...condition, key })}
            options={optionsWithCurrent(
              fields.map((field) => ({ value: field.fieldKey, label: field.name })),
              condition.key ?? '',
              '選択済みの友だち情報',
              referenceErrors.fields ? '友だち情報を読み込めませんでした' : fields.length ? '友だち情報を選ぶ' : '友だち情報がありません',
            )}
            className="min-w-44 flex-1"
          />
          {/*
            実行側が解釈できるものだけを選べるようにする（ATTR-13）。
            「登録あり／なし」と大小比較は以前は画面から作れず、
            保存済みの条件に混ざると表示も保存も壊れていた。
          */}
          <Select
            aria-label="友だち情報の比較"
            value={condition.op}
            onChange={(op) => onChange({ ...condition, op, value: isSavedSearchValueOptionalOp(op) ? '' : condition.value })}
            options={[
              { value: 'eq', label: '等しい' },
              { value: 'ne', label: '等しくない' },
              { value: 'contains', label: '含む' },
              { value: 'not_contains', label: '含まない' },
              { value: 'gte', label: '以上' },
              { value: 'gt', label: 'より大きい' },
              { value: 'lte', label: '以下' },
              { value: 'lt', label: 'より小さい' },
              { value: 'exists', label: '登録あり' },
              { value: 'not_exists', label: '登録なし' },
            ]}
            className="w-32"
          />
          {isSavedSearchValueOptionalOp(condition.op) ? (
            <span className="min-w-0 flex-1 text-xs text-ink-faint">値の有無だけで絞ります。入力は不要です。</span>
          ) : (
            <TextInput value={rawValue} onChange={(event) => onChange({ ...condition, value: event.target.value })} placeholder="値" className="min-w-40 flex-1" />
          )}
        </>
      ) : condition.kind === 'mark' ? (
        <Select
          aria-label="対応マーク"
          value={rawValue}
          disabled={referenceErrors.marks}
          onChange={(value) => onChange({ ...condition, value })}
          options={optionsWithCurrent(
            marks.map((mark) => ({ value: mark.id, label: mark.name })),
            rawValue,
            '選択済みの対応マーク',
            referenceErrors.marks ? '対応マークを読み込めませんでした' : marks.length ? '対応マークを選ぶ' : '対応マークがありません',
          )}
          className="min-w-44 flex-1"
        />
      ) : condition.kind === 'scenario' ? (
        <Select
          aria-label="シナリオ"
          value={rawValue}
          disabled={referenceErrors.scenarios}
          onChange={(value) => onChange({ ...condition, value })}
          options={optionsWithCurrent(
            scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name })),
            rawValue,
            '選択済みのシナリオ',
            referenceErrors.scenarios ? 'シナリオを読み込めませんでした' : scenarios.length ? 'シナリオを選ぶ' : 'シナリオがありません',
          )}
          className="min-w-44 flex-1"
        />
      ) : condition.kind === 'following' ? (
        <Select aria-label="友だち状態" value={condition.value === false ? 'false' : 'true'} onChange={(value) => onChange({ ...condition, value: value === 'true' })} options={[{ value: 'true', label: '友だち中' }, { value: 'false', label: 'ブロック済み' }]} className="min-w-44 flex-1" />
      ) : condition.kind === 'chat_status' ? (
        <Select aria-label="対応状況" value={rawValue} onChange={(value) => onChange({ ...condition, value })} options={[{ value: '', label: '対応状況を選ぶ' }, { value: 'unread', label: '未対応' }, { value: 'in_progress', label: '対応中' }, { value: 'on_hold', label: '保留' }, { value: 'resolved', label: '対応済み' }]} className="min-w-44 flex-1" />
      ) : condition.kind === 'assignee' ? (
        <>
          <Select
            aria-label="担当者の比較"
            value={condition.op === 'ne' ? 'ne' : 'eq'}
            onChange={(op) => onChange({ ...condition, op })}
            options={[{ value: 'eq', label: '次の担当' }, { value: 'ne', label: '次以外' }]}
            className="w-32"
          />
          <Select
            aria-label="担当者"
            value={rawValue}
            disabled={referenceErrors.operators}
            onChange={(value) => onChange({ ...condition, value })}
            options={optionsWithCurrent(
              operators.map((operator) => ({ value: operator.id, label: operator.name })),
              rawValue,
              '選択済みの担当者',
              referenceErrors.operators ? '担当者を読み込めませんでした' : operators.length ? '担当者を選ぶ' : '担当者がいません',
            )}
            className="min-w-44 flex-1"
          />
        </>
      ) : condition.kind === 'form' ? (
        <>
          <Select
            aria-label="回答フォームの有無"
            value={canonicalExistenceOp(condition.op)}
            onChange={(op) => onChange({ ...condition, op })}
            options={[{ value: 'exists', label: '回答がある' }, { value: 'not_exists', label: '回答がない' }]}
            className="w-32"
          />
          <Select
            aria-label="回答フォーム"
            value={rawValue}
            disabled={referenceErrors.forms}
            onChange={(value) => onChange({ ...condition, value })}
            options={optionsWithCurrent(
              forms.map((form) => ({ value: form.id, label: form.name })),
              rawValue,
              '選択済みの回答フォーム',
              referenceErrors.forms ? '回答フォームを読み込めませんでした' : 'すべての回答フォーム',
            )}
            className="min-w-44 flex-1"
          />
        </>
      ) : condition.kind === 'purchase' ? (
        <>
          <Select
            aria-label="購入履歴の有無"
            value={canonicalExistenceOp(condition.op)}
            onChange={(op) => onChange({ ...condition, op })}
            options={[{ value: 'exists', label: '購入がある' }, { value: 'not_exists', label: '購入がない' }]}
            className="w-32"
          />
          <TextInput value={rawValue} onChange={(event) => onChange({ ...condition, value: event.target.value })} placeholder="空欄はすべての購入" aria-label="購入イベントの種類（空欄可）" className="min-w-40 flex-1" />
        </>
      ) : condition.kind === 'common_event' ? (
        <>
          <Select
            aria-label="その他のイベントの有無"
            value={canonicalExistenceOp(condition.op)}
            onChange={(op) => onChange({ ...condition, op })}
            options={[{ value: 'exists', label: '発生がある' }, { value: 'not_exists', label: '発生がない' }]}
            className="w-32"
          />
          <TextInput value={rawValue} onChange={(event) => onChange({ ...condition, value: event.target.value })} placeholder="イベント種別（例：conversion）" aria-label="イベント種別" className="min-w-40 flex-1" />
        </>
      ) : condition.kind === 'memo' ? (
        <>
          <Select
            aria-label="個別メモの比較"
            value={['exists', 'has', 'not_exists', 'not_has', 'eq', 'contains'].includes(condition.op) ? condition.op : 'exists'}
            onChange={(op) => onChange({ ...condition, op, value: isSavedSearchValueOptionalOp(op) ? '' : condition.value })}
            options={[
              { value: 'exists', label: 'メモがある' },
              { value: 'not_exists', label: 'メモがない' },
              { value: 'eq', label: '等しい' },
              { value: 'contains', label: '含む' },
            ]}
            className="w-32"
          />
          {isSavedSearchValueOptionalOp(condition.op) ? (
            <span className="min-w-0 flex-1 text-xs text-ink-faint">有無だけで絞ります。入力は不要です。</span>
          ) : (
            <TextInput value={rawValue} onChange={(event) => onChange({ ...condition, value: event.target.value })} placeholder="メモの内容" aria-label="メモの内容" className="min-w-40 flex-1" />
          )}
        </>
      ) : EXISTENCE_KINDS.has(condition.kind) ? (
        <Select
          aria-label={`${EDITABLE_KINDS.find((item) => item.value === condition.kind)?.label ?? '条件'}の有無`}
          value={canonicalExistenceOp(condition.op)}
          onChange={(op) => onChange({ ...condition, op })}
          options={[{ value: 'exists', label: 'ある' }, { value: 'not_exists', label: 'ない' }]}
          className="w-32"
        />
      ) : DATE_RANGE_KINDS.has(condition.kind) ? (
        <DateRangeEditor condition={condition} onChange={onChange} />
      ) : (
        <TextInput value={rawValue} onChange={(event) => onChange({ ...condition, value: event.target.value })} placeholder="値を入力" className="min-w-44 flex-1" />
      )}
    </>
  )
}

/** ★V8: 条件1行。「かつ／または」の印・選ぶ欄・値・×。 */
function ConditionRow({
  combinator,
  condition,
  tags,
  marks,
  scenarios,
  fields,
  forms,
  operators,
  referenceErrors,
  onChange,
  onDelete,
}: {
  combinator: 'かつ' | 'または'
  condition: SavedSearchCondition
  tags: Tag[]
  marks: SupportMark[]
  scenarios: Scenario[]
  fields: FriendField[]
  forms: Array<{ id: string; name: string }>
  operators: Array<{ id: string; name: string }>
  referenceErrors: { marks: boolean; scenarios: boolean; fields: boolean; forms: boolean; operators: boolean }
  onChange: (next: SavedSearchCondition) => void
  onDelete: () => void
}) {
  return (
    <div className={styles.conditionRow}>
      <span className={styles.conditionOp}>{combinator}</span>
      <div className={styles.conditionBox}>
        <ConditionControls
          condition={condition}
          tags={tags}
          marks={marks}
          scenarios={scenarios}
          fields={fields}
          forms={forms}
          operators={operators}
          referenceErrors={referenceErrors}
          onChange={onChange}
        />
      </div>
      <button type="button" aria-label="この条件を削除する" title="この条件を削除する" onClick={onDelete} className={styles.conditionRemove}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

function SearchEditorV8Inner() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const { selectedAccountId, selectedAccount } = useAccount()
  const [original, setOriginal] = useState<SavedSearchDetail | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [marks, setMarks] = useState<SupportMark[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [fields, setFields] = useState<FriendField[]>([])
  /* R185: 回答フォーム・担当者の条件も名前で選ぶための候補。 */
  const [forms, setForms] = useState<Array<{ id: string; name: string }>>([])
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>([])
  const [referenceErrors, setReferenceErrors] = useState({ marks: false, scenarios: false, fields: false, forms: false, operators: false })
  const [name, setName] = useState('')
  const [conditions, setConditions] = useState<SavedSearchConditions>({ all: [], any: [] })
  const [isShared, setIsShared] = useState(false)
  /** 保存済みの総数。上限50件までの残りを共有範囲の下に出すために持つ。 */
  const [savedCount, setSavedCount] = useState<number | null>(null)
  /** IDEA-04: 同名の検索がすでにあるか確かめるための、ほかの検索の名前。 */
  const [siblingSearches, setSiblingSearches] = useState<Array<{ id: string; name: string }>>([])
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [preview, setPreview] = useState<SavedSearchMatchPreview | null>(null)
  const [previewStale, setPreviewStale] = useState(false)
  /** 計算失敗と「まだ計算していない」を分ける。黙って0扱いしない。 */
  const [previewError, setPreviewError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  /** 404・空で見つからないとき。取得の失敗（error）とは分ける。 */
  const [searchMissing, setSearchMissing] = useState(false)
  /** 失敗したあとの「もう一度読み込む」で取り直すための番号。 */
  const [reloadKey, setReloadKey] = useState(0)

  usePageTitle('保存した検索を編集')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: '友だち属性', href: '/tags' }, { label: '保存した検索', href: '/tags?tab=searches' }])

  /*
    ATTR-12: 再計算の連打・条件変更・アカウント切替で、古い計算結果が
    新しい条件の人数を上書きしてはいけない。要求ごとに世代の印を取り、
    応答時に「いまの条件の要求か」「いまのアカウントか」を照合する。
  */
  const gateRef = useRef(createResponseGate())
  const accountRef = useRef(selectedAccountId)
  accountRef.current = selectedAccountId
  /*
   * R518: アカウントまたは検索IDの切替で飛んだ読み直しの世代。
   * 古い応答が届いても今の対象のものでなければ捨て、前のアカウントの
   * 内容を表示しない。
   */
  const loadGenerationRef = useRef(0)

  /*
   * R179: 保存直後の再計算は、保存応答の新しい版と正規化済み条件を
   * 明示的に渡す。以前は `setOriginal` の直後に保存前の `recount` を
   * 呼んでおり、クロージャの古い版で計算して409になり、人数が
   * 「未計算・人数を計算できませんでした」になっていた。
   */
  const recount = useCallback(async (next?: { revision?: number; conditions?: SavedSearchConditions }) => {
    if (!selectedAccountId || !id) return
    const account = selectedAccountId
    const token = gateRef.current.begin()
    setPreviewError('')
    try {
      const res = await api.savedSearches.preview(account, {
        savedSearchId: id,
        conditions: next?.conditions ?? conditions,
        revision: next?.revision ?? original?.revision,
      })
      if (!gateRef.current.current(token) || accountRef.current !== account) return
      setPreviewCount(res.success ? res.data.match.total : null)
      setPreview(res.success ? res.data.match : null)
      setPreviewStale(false)
      /* 応答は成功でも中身の計算が失敗していることがある（match.error）。 */
      if (!res.success) setPreviewError(res.error)
      else setPreviewError(res.data.match.error ?? '')
    } catch {
      if (!gateRef.current.current(token) || accountRef.current !== account) return
      setPreviewCount(null)
      setPreview(null)
      setPreviewError('人数を計算できませんでした。条件を確かめて再計算してください。')
    }
  }, [conditions, id, original?.revision, selectedAccountId])

  useEffect(() => {
    const generation = loadGenerationRef.current + 1
    loadGenerationRef.current = generation
    let cancelled = false
    /*
     * R518: アカウントまたは検索IDの切替時点で、前対象の表示・操作を
     * 無効にする。読み直しが終わるまで `original` を空にし、取得に失敗
     * しても前の名前・条件と複製・保存・削除が残らないようにする。
     * 飛んでいる人数の再計算も今の対象のものではないので無効にする。
     */
    gateRef.current.invalidate()
    setOriginal(null)
    setName('')
    setConditions({ all: [], any: [] })
    setIsShared(false)
    setTags([])
    setMarks([])
    setScenarios([])
    setFields([])
    setForms([])
    setOperators([])
    setReferenceErrors({ marks: false, scenarios: false, fields: false, forms: false, operators: false })
    setSavedCount(null)
    setSiblingSearches([])
    setPreviewCount(null)
    setPreview(null)
    setPreviewStale(false)
    setPreviewError('')
    setLoading(true)
    setError('')
    setSearchMissing(false)
    if (!selectedAccountId || !id) {
      setLoading(false)
      return
    }
    void Promise.all([
      api.savedSearches.detail(id, selectedAccountId),
      api.savedSearches.list(selectedAccountId, { limit: 50 }),
      // R23横展開: タグ候補も今のアカウントだけ（条件の表示名の取り違え防止）。
      api.tags.list({ accountId: selectedAccountId }),
      api.supportMarks.list(selectedAccountId, { suppressFeatureDisabledEvent: true }).catch(() => null),
      api.scenarios.list({ accountId: selectedAccountId }).catch(() => null),
      api.friendFields.list(selectedAccountId, undefined, { suppressFeatureDisabledEvent: true }).catch(() => null),
      api.forms.list(selectedAccountId).catch(() => null),
      api.operators.list().catch(() => null),
    ]).then(([detail, searches, tagResult, markResult, scenarioResult, fieldResult, formResult, operatorResult]) => {
      // R518: 切替後に届いた古い応答は捨てる。今の対象の再試行だけを描く。
      if (cancelled || generation !== loadGenerationRef.current) return
      if (tagResult.success) setTags(tagResult.data)
      setMarks(markResult?.success ? markResult.data : [])
      setScenarios(scenarioResult?.success ? scenarioResult.data : [])
      setFields(fieldResult?.success ? fieldResult.data : [])
      setForms(formResult?.success ? formResult.data : [])
      setOperators(operatorResult?.success ? operatorResult.data : [])
      setReferenceErrors({
        marks: markResult?.success !== true,
        scenarios: scenarioResult?.success !== true,
        fields: fieldResult?.success !== true,
        forms: formResult?.success !== true,
        operators: operatorResult?.success !== true,
      })
      setSavedCount(searches.success ? searches.summary.total : null)
      setSiblingSearches(searches.success ? searches.items.map((item) => ({ id: item.id, name: item.name })) : [])
      const found = detail.success ? detail.data : null
      if (!found) {
        setError('保存した検索が見つかりません')
        setSearchMissing(true)
        return
      }
      /*
       * R184: 別の検索へ移ったときは未計算の印と前の検索の失敗を捨てる。
       * 以前は残り続け、保存済みのコピーにも「変更後は未計算」と出て
       * 不要な再読込を要求していた。飛んでいる再計算も今の検索の
       * ものではないので無効にする。
       */
      gateRef.current.invalidate()
      setPreviewStale(false)
      setOriginal(found)
      setName(found.name)
      setConditions(normalizeForEdit(found))
      setIsShared(found.isShared)
      setPreviewCount(found.matchCount ?? null)
      setPreview(found.match)
      /* IDEA-04: 計算に失敗している保存値を「計算済み」の時点付きで見せない。 */
      setPreviewError(found.match.error ?? '')
    }).catch((caught: unknown) => {
      // R518: 古い対象の失敗で今の画面を上書きしない。前の内容は既に消してある。
      if (cancelled || generation !== loadGenerationRef.current) return
      if (caught instanceof ApiError && caught.status === 404) {
        setError('保存した検索が見つかりません')
        setSearchMissing(true)
      } else {
        setError('保存した検索を読み込めませんでした')
      }
    }).finally(() => {
      if (!cancelled && generation === loadGenerationRef.current) setLoading(false)
    })
    return () => { cancelled = true }
  }, [id, reloadKey, selectedAccountId])

  const dirty = useMemo(() => {
    if (!original) return false
    return name !== original.name || isShared !== original.isShared
      || JSON.stringify(conditions) !== JSON.stringify(normalizeForEdit(original))
  }, [conditions, isShared, name, original])
  /*
   * 未保存の条件変更がある間、画面を離れる操作を止める共通の番兵（DETAIL-04系）。
   * 「保存した検索へ」「キャンセル」「該当者を確認」などのリンクも同じ確認対話へ寄せる。
   */
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  /*
   * IDEA-04: 変更前後の条件を人が読める形で並べる。
   * IDのまま出すと「何が変わったか」が読めないので、一覧と同じ
   * `describeSavedCondition`（savedSearchSummary）で言葉にする。
   */
  const conditionLabels = useMemo<SavedSearchConditionLabels>(() => ({
    marks: Object.fromEntries(marks.map((mark) => [mark.id, mark.name])),
    scenarios: Object.fromEntries(scenarios.map((scenario) => [scenario.id, scenario.name])),
    fields: Object.fromEntries(fields.map((field) => [field.fieldKey, field.name])),
    forms: Object.fromEntries(forms.map((form) => [form.id, form.name])),
    assignees: Object.fromEntries(operators.map((operator) => [operator.id, operator.name])),
  }), [marks, scenarios, fields, forms, operators])
  const beforeSummary = useMemo(
    () => (original ? savedSearchSummary(original.conditions, tags, conditionLabels) : []),
    [original, tags, conditionLabels],
  )
  const afterSummary = useMemo(
    () => savedSearchSummary(conditions, tags, conditionLabels),
    [conditions, tags, conditionLabels],
  )
  const nameDuplicates = useMemo(
    () => findDuplicateNames(siblingSearches, name, id),
    [siblingSearches, name, id],
  )

  const patchConditions = (next: SavedSearchConditions) => {
    /*
      条件が変わった時点で、飛んでいる再計算は今の条件のものではない。
      応答が届いても人数を上書きさせない（ATTR-12）。
    */
    gateRef.current.invalidate()
    setConditions(next)
    setPreviewStale(true)
  }

  const save = async () => {
    if (!selectedAccountId || !id || saving) return
    if (!name.trim()) { setError('条件名を入力してください'); return }
    const editableConditions = [...(conditions.all ?? []), ...(conditions.any ?? [])]
    const problem = editableConditions.length === 0
      ? '条件を1つ以上追加してください'
      : editableConditions.map(conditionProblem).find(Boolean)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await api.savedSearches.update(id, selectedAccountId, { name: name.trim(), conditions, isShared, expectedRevision: original?.revision ?? 1 })
      if (!res.success) { setError(res.error); return }
      const refreshed = await api.savedSearches.detail(id, selectedAccountId)
      if (!refreshed.success) throw new Error(refreshed.error)
      setOriginal(refreshed.data)
      const normalized = normalizeForEdit(refreshed.data)
      setConditions(normalized)
      setPreviewStale(false)
      /* R179: 保存応答の新しい版と正規化済み条件で数え直す。古い版では409になる。 */
      await recount({ revision: refreshed.data.revision, conditions: normalized })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '変更を保存できませんでした')
    } finally {
      setSaving(false)
    }
  }

  const duplicate = async () => {
    if (!selectedAccountId || saving) return
    const editableConditions = [...(conditions.all ?? []), ...(conditions.any ?? [])]
    const problem = editableConditions.length === 0
      ? '条件を1つ以上追加してください'
      : editableConditions.map(conditionProblem).find(Boolean)
    if (problem) { setError(problem); return }
    setSaving(true)
    setError('')
    try {
      const res = await api.savedSearches.create({ name: `${name.trim() || '保存した検索'} のコピー`, accountId: selectedAccountId, conditions, isShared: false })
      /* 失敗を黙って捨てない。捨てると押しても画面が変わらず次行動が分からない。 */
      if (!res.success) { setError(res.error); return }
      router.push(`/tags/searches/edit?id=${encodeURIComponent(res.data.id)}`)
    } catch (duplicateError) {
      setError(duplicateError instanceof Error ? duplicateError.message : '複製できませんでした')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!selectedAccountId || !id || original?.canDelete !== true) return
    try {
      await api.savedSearches.delete(id, selectedAccountId)
      router.push('/tags?tab=searches')
    } catch (deleteError) {
      setError(deleteError instanceof ApiError ? deleteError.message : '削除できませんでした')
    }
  }

  if (loading) return <p className="text-sm text-ink-faint">読み込んでいます</p>
  if (!id) {
    return (
      <TargetMissing
        kind="unspecified"
        title="編集する保存した検索が指定されていません"
        description="一覧から編集する検索を選び直してください。"
        backHref="/tags?tab=searches"
        backLabel="保存した検索の一覧へ戻る"
      />
    )
  }
  if (!selectedAccountId) return <p className="rounded-card border border-hairline bg-canvas p-5 text-sm text-ink-secondary">上部でLINE公式アカウントを選んでください。</p>
  /* #975 U069: 見つからないときも行き止まりにしない。一覧へ戻る道を出す。 */
  if (!original && (searchMissing || !error)) {
    return (
      <TargetMissing
        kind="not-found"
        title="保存した検索が見つかりません"
        description="削除されたか、別のLINEアカウントの検索です。一覧から選び直せます。"
        accountName={selectedAccount?.name}
        backHref="/tags?tab=searches"
        backLabel="保存した検索の一覧へ戻る"
      />
    )
  }
  if (!original) {
    return (
      <TargetMissing
        kind="error"
        title="保存した検索を読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    )
  }

  const allConditions = conditions.all ?? []
  const anyConditions = conditions.any ?? []

  return (
    <div className={styles.board}>
      <div className={styles.head} data-design="Head">
        <div>
          <h2 className={styles.headTitle}>保存した検索を編集</h2>
          <p className={styles.headDescription}>絞り込みの条件と、友だち一覧での見せ方を変えます。</p>
        </div>
      </div>

      {error ? <Notice tone="danger" message={error} /> : null}

      <div className={styles.split} data-design="Body">
        <div className={styles.main} data-design="Left">
          {/* 段：名前と共有 */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>名前と共有</h2>
            <div className={styles.sectionBody}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>条件名</span>
                <TextInput value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className="max-w-xl" aria-label="条件名" />
                {/* IDEA-04: 同名の検索がすでにあるとき、保存する前に知らせる。 */}
                <DuplicateNameNote duplicates={nameDuplicates} kindLabel="保存した検索" />
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>説明</span>
                <TextInput value={conditions.description ?? ''} maxLength={300} onChange={(event) => patchConditions({ ...conditions, description: event.target.value })} placeholder="この検索を使う目的" className="max-w-xl" aria-label="説明" />
              </div>
              <RadioCardGroup legend="共有範囲">
                <RadioCard name="saved-search-share" value="shared" checked={isShared} onChange={() => setIsShared(true)} title="全員" note="他の担当者からも使えます" />
                <RadioCard name="saved-search-share" value="private" checked={!isShared} onChange={() => setIsShared(false)} title="自分だけ" />
              </RadioCardGroup>
              {/*
                設計 `XBkiQ`：共有範囲を選ぶ場所で、上限と「共有すると何が
                起きるか」を先に言う。50件に近づいてから初めて知る、という
                順番にしない。件数は一覧の取得結果そのものなので、読めて
                いないときは数を出さずに上限だけ書く。
              */}
              <p className={styles.noteText}>
                {savedCount === null
                  ? '保存できるのは50件までです。'
                  : `保存できるのは50件までです（いま${savedCount}件）。`}
                共有すると、一斉配信・オートメーションの対象条件からも呼び出せます。
              </p>
              {/* IDEA-04: 条件の保存は「保存した検索」。印ならタグ・値なら情報欄という違いを、編集の場所でも確認できるようにする。 */}
              <AttributeKindGuide current="search" />
            </div>
          </section>

          {/* 段：条件（行ごとに「かつ／または」・選ぶ欄・値・×） */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>条件</h2>
            <p className={styles.sectionDesc}>「かつ」はすべて満たす人、「または」はいずれかを満たす人に当てはまります。</p>
            <div className={styles.sectionBody}>
              {allConditions.length === 0 && anyConditions.length === 0 ? (
                <p className={styles.noteText}>条件はまだありません。必要な場合だけ追加します。</p>
              ) : null}
              {allConditions.map((condition, index) => (
                <ConditionRow
                  key={`all-${index}`}
                  combinator="かつ"
                  condition={condition}
                  tags={tags}
                  marks={marks}
                  scenarios={scenarios}
                  fields={fields}
                  forms={forms}
                  operators={operators}
                  referenceErrors={referenceErrors}
                  onChange={(next) => patchConditions({ ...conditions, all: allConditions.map((item, i) => i === index ? next : item) })}
                  onDelete={() => patchConditions({ ...conditions, all: allConditions.filter((_, i) => i !== index) })}
                />
              ))}
              {anyConditions.map((condition, index) => (
                <ConditionRow
                  key={`any-${index}`}
                  combinator="または"
                  condition={condition}
                  tags={tags}
                  marks={marks}
                  scenarios={scenarios}
                  fields={fields}
                  forms={forms}
                  operators={operators}
                  referenceErrors={referenceErrors}
                  onChange={(next) => patchConditions({ ...conditions, any: anyConditions.map((item, i) => i === index ? next : item) })}
                  onDelete={() => patchConditions({ ...conditions, any: anyConditions.filter((_, i) => i !== index) })}
                />
              ))}
              <div className={styles.addButtons}>
                <Button type="button" onClick={() => patchConditions({ ...conditions, all: [...allConditions, defaultCondition(tags)] })}>かつの条件を足す</Button>
                <Button type="button" onClick={() => patchConditions({ ...conditions, any: [...anyConditions, defaultCondition(tags)] })}>またはの条件を足す</Button>
              </div>
            </div>
          </section>

          {/* 段：友だち一覧での見せ方 */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>友だち一覧での見せ方</h2>
            <div className={styles.sectionBody}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>並び順</span>
                {/* R188: 一覧の実装は友だち追加日順。最終接触と書くと運用者の意図とずれる。 */}
                <Select aria-label="並び順" value={conditions.list?.sort ?? 'recent'} onChange={(value) => patchConditions({ ...conditions, list: { ...conditions.list, sort: value as 'recent' | 'oldest' } })} options={[{ value: 'recent', label: '友だち追加の新しい順' }, { value: 'oldest', label: '友だち追加の古い順' }]} size="full" />
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>表示件数</span>
                <Select aria-label="表示件数" value={String(conditions.list?.limit ?? 20)} onChange={(value) => patchConditions({ ...conditions, list: { ...conditions.list, limit: Number(value) as 10 | 20 | 30 | 40 | 50 } })} options={[10, 20, 30, 40, 50].map((size) => ({ value: String(size), label: `${size}件表示` }))} size="full" />
              </div>
              <p className={styles.columnsNote}>表示列：{conditions.list?.columns?.join('・') || '名前・タグ・担当者'}</p>
            </div>
          </section>
        </div>

        {/* 右の欄 */}
        <div className={styles.side} data-design="Right">
          {/* 当てはまる人 */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>当てはまる人</h2>
            <p className={styles.countValue}><MetricValue value={previewCount} unit="人" /></p>
            {/*
              IDEA-04: 人数をいつ・どの条件で計ったかを出す。
              条件を変えたあとは、出ている人数が「変更前の条件」のもので
              「変更後の条件」は未計算だと分かるようにする。取れていない
              ときは計算時点を出さない（推定で埋めない）。
            */}
            <p className={styles.countTime}>
              {previewError || preview?.error
                ? '未計算'
                : preview?.calculatedAt
                  ? `${formatDateTime(preview.calculatedAt)}に計算`
                  : '未計算'}
            </p>
            {previewError ? (
              <p role="alert" className="mt-2 text-xs text-danger">{previewError}</p>
            ) : previewStale ? (
              <Notice tone="warn" className="mt-2">
                <p className="text-xs font-semibold">条件を変更しました。上の人数は変更前の条件のもので、変更後の条件は未計算です。</p>
                <p className="mt-1 text-xs"><span className="font-semibold">変更前：</span>{beforeSummary.length ? beforeSummary.join('・') : '条件なし'}</p>
                <p className="mt-1 text-xs"><span className="font-semibold">変更後：</span>{afterSummary.length ? afterSummary.join('・') : '条件なし'}</p>
              </Notice>
            ) : (
              <p className={`${styles.noteText} mt-2`}>{preview ? `LINE ${preview.byChannel.line ?? '—'}人・MAIL ${preview.byChannel.mail ?? '—'}人` : '保存済み条件で集計'}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" onClick={() => void recount()}>数え直す</Button>
              <Button href={`/friends?savedSearch=${encodeURIComponent(id)}`} variant="primary">当てはまる人を見る</Button>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>使うときの参照の仕方</h2>
            <div className={styles.sectionBody}>
              <p className={styles.noteText}><strong className="text-ink">ライブ参照</strong>　使うたびに条件で数え直し、人の出入りを反映します。</p>
              <p className={styles.noteText}><strong className="text-ink">固定</strong>　保存した時点の人を使い、あとから条件を変えても対象は変えません。</p>
              <Notice tone="warn">{original.usedIn?.some((usage) => usage.mode === 'live') ? 'ライブ参照の使用先は、条件を変えると次回実行から対象が変わります。' : '現在、ライブ参照の使用先はありません。'}</Notice>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>この条件の使用先</h2>
            <div className={styles.sectionBody}>
              {original.usedIn === undefined ? (
                <p className={styles.noteText}>—</p>
              ) : original.usedIn.length === 0 ? (
                <p className={styles.noteText} style={{ fontWeight: 600 }}>使用先はありません</p>
              ) : (
                <ul className={styles.useList}>
                  {original.usedIn.map((usage) => (
                    <li key={`${usage.kind}:${usage.id}`} className={styles.useItem}>
                      <span className={styles.useItemKind}>{USAGE_KIND_LABELS[usage.kind]}</span>
                      <span className="ml-1">{usage.name}</span>
                      <span className={styles.useItemMeta}>{usage.mode === 'live' ? '条件を自動反映' : '固定した条件'}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className={styles.noteText}>使用先がある検索は、先に参照を外すまで削除できません。</p>
            </div>
          </section>
        </div>
      </div>

      <StickyBar
        destructive={<Button variant="danger" className="px-4 py-2 font-bold border-0 h-auto whitespace-normal" type="button" disabled={original.canDelete !== true} onClick={() => setDeleteOpen(true)} title={original.canDelete === true ? 'この条件を削除' : original.usedIn === undefined ? '使用先を確認できないため削除できません' : original.usedIn.length > 0 ? `使用中のため削除できません（${original.usedIn.length}件）` : '削除できるか確認できません'}>この条件を削除する</Button>}
        status={dirty ? '変更内容を確認して保存してください' : undefined}
        actions={(
          <>
            <Button href="/tags?tab=searches">キャンセル</Button>
            <Button type="button" disabled={saving} onClick={() => void duplicate()}>複製して保存する</Button>
            <Button type="button" variant="primary" disabled={saving || !dirty} onClick={() => void save()} busy={saving}>保存する</Button>
          </>
        )}
      />
      <ConfirmDialog open={deleteOpen && original.canDelete === true} title={`「${name}」を削除しますか？`} description="使用先が無いことをサーバーで確認済みです。保存した条件だけを削除し、友だちは削除しません。" confirmLabel="削除する" destructive onCancel={() => setDeleteOpen(false)} onConfirm={() => { setDeleteOpen(false); void remove() }} />
      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        subject="検索条件への変更"
        busy={saving}
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
    </div>
  )
}

export default function SearchEditorV8() {
  return <SearchEditorV8Inner />
}

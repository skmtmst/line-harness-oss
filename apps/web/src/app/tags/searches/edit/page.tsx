'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
import FeatureGate from '@/components/feature-gate'
import { usePageTitle } from '@/components/shell/page-chrome'
import Breadcrumb from '@/components/layout/breadcrumb'
import StickyBar from '@/components/shared/sticky-bar'
import TargetMissing from '@/components/shared/target-missing'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { TextInput } from '@/components/shared/form-controls'
import DateField from '@/components/shared/date-field'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import { optionsWithCurrent } from './reference-options'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { savedSearchSummary, type SavedSearchConditionLabels } from '@/components/friends/saved-search-utils'
import MetricValue from '@/components/ui/metric-value'
import { AttributeKindGuide, DuplicateNameNote, findDuplicateNames } from '@/components/friend-fields/attribute-kind-guide'

const EDITABLE_KINDS: Array<{ value: SavedSearchConditionKind; label: string }> = [
  { value: 'tag', label: 'タグ' },
  { value: 'name', label: '名前' },
  { value: 'field', label: '友だち情報' },
  { value: 'status_message', label: 'ステータスメッセージ' },
  { value: 'mark', label: '対応マーク' },
  { value: 'scenario', label: 'シナリオ' },
  { value: 'chat_status', label: '対応状況' },
  { value: 'following', label: '友だち状態' },
  { value: 'created_at', label: '友だち追加日' },
]

const UNSUPPORTED_KINDS = new Set<SavedSearchConditionKind>(['form', 'purchase'])
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
  if (UNSUPPORTED_KINDS.has(condition.kind)) return '未接続の条件を削除してください'
  if (!isSavedSearchOpAllowed(condition.kind, condition.op)) {
    return `${EDITABLE_KINDS.find((item) => item.value === condition.kind)?.label ?? '条件'}では使えない比較方法です`
  }
  if (condition.kind === 'following') return typeof condition.value === 'boolean' ? null : '友だち状態を選んでください'
  if (condition.kind === 'created_at') {
    const range = condition.value && typeof condition.value === 'object'
      ? condition.value as { from?: unknown; to?: unknown }
      : null
    return range && (range.from || range.to) ? null : '友だち追加日を入力してください'
  }
  if (condition.kind === 'field' && !condition.key?.trim()) return '友だち情報の項目名を入力してください'
  /*
    「登録あり／なし」は値を取らない。値の必須チェックへ落とさない。
    ただし値そのものが選択対象になる条件（タグの has 等）では
    使わないので、値を取らない kind だけに限る。
  */
  if ((condition.kind === 'field' || condition.kind === 'memo') && isSavedSearchValueOptionalOp(condition.op)) return null
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

function ConditionEditor({
  condition,
  tags,
  marks,
  scenarios,
  fields,
  referenceErrors,
  onChange,
  onDelete,
}: {
  condition: SavedSearchCondition
  tags: Tag[]
  marks: SupportMark[]
  scenarios: Scenario[]
  fields: FriendField[]
  referenceErrors: { marks: boolean; scenarios: boolean; fields: boolean }
  onChange: (next: SavedSearchCondition) => void
  onDelete: () => void
}) {
  const unsupported = UNSUPPORTED_KINDS.has(condition.kind)
  const changeKind = (kind: SavedSearchConditionKind) => {
    if (kind === 'tag') onChange({ kind, op: 'includes', value: tags[0]?.id ?? '' })
    else if (kind === 'field') onChange({ kind, key: fields[0]?.fieldKey ?? '', op: 'eq', value: '' })
    else if (kind === 'mark') onChange({ kind, op: 'eq', value: marks[0]?.id ?? '' })
    else if (kind === 'scenario') onChange({ kind, op: 'eq', value: scenarios[0]?.id ?? '' })
    else if (kind === 'following') onChange({ kind, op: 'eq', value: true })
    else if (kind === 'created_at') onChange({ kind, op: 'between', value: { from: '', to: '' } })
    else onChange({ kind, op: kind === 'name' || kind === 'status_message' ? 'contains' : 'eq', value: '' })
  }
  const rawValue = typeof condition.value === 'string' ? condition.value : ''

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-control border border-hairline bg-canvas p-2">
      <Select aria-label="条件の種類" value={condition.kind} disabled={unsupported} onChange={(value) => changeKind(value as SavedSearchConditionKind)} options={unsupported ? [{ value: condition.kind, label: condition.kind === 'form' ? '回答フォーム' : '購入履歴' }] : EDITABLE_KINDS} className="w-36" />

      {unsupported ? (
        <span className="min-w-0 flex-1 text-xs text-status-warn-deep">この条件は実行口が未接続です。削除するまで保存・実行できません。</span>
      ) : condition.kind === 'tag' ? (
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
              referenceErrors.fields ? '友だち情報を取得できません' : fields.length ? '友だち情報を選ぶ' : '友だち情報がありません',
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
            referenceErrors.marks ? '対応マークを取得できません' : marks.length ? '対応マークを選ぶ' : '対応マークがありません',
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
            referenceErrors.scenarios ? 'シナリオを取得できません' : scenarios.length ? 'シナリオを選ぶ' : 'シナリオがありません',
          )}
          className="min-w-44 flex-1"
        />
      ) : condition.kind === 'following' ? (
        <Select aria-label="友だち状態" value={condition.value === false ? 'false' : 'true'} onChange={(value) => onChange({ ...condition, value: value === 'true' })} options={[{ value: 'true', label: '友だち中' }, { value: 'false', label: 'ブロック済み' }]} className="min-w-44 flex-1" />
      ) : condition.kind === 'chat_status' ? (
        <Select aria-label="対応状況" value={rawValue} onChange={(value) => onChange({ ...condition, value })} options={[{ value: '', label: '対応状況を選ぶ' }, { value: 'unread', label: '未対応' }, { value: 'in_progress', label: '対応中' }, { value: 'on_hold', label: '保留' }, { value: 'resolved', label: '対応済み' }]} className="min-w-44 flex-1" />
      ) : condition.kind === 'created_at' ? (
        /*
          ATTR-16: 390pxでは開始/終了を縦に積み、それぞれラベルを付ける。
          以前の `min-w-80` はカードの最小幅を押し広げて、条件名・共有範囲
          まで画面の外へはみ出していた。
        */
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
          <label className="min-w-40 flex-1 text-xs font-semibold text-ink-faint">
            開始日
            <DateField aria-label="開始日" value={typeof condition.value === 'object' && condition.value ? String((condition.value as { from?: string }).from ?? '') : ''} onChange={(v) => onChange({ ...condition, op: 'between', value: { ...(typeof condition.value === 'object' ? condition.value : {}), from: v } })} className="mt-1" />
          </label>
          <span className="pb-2 text-ink-faint" aria-hidden="true">〜</span>
          <label className="min-w-40 flex-1 text-xs font-semibold text-ink-faint">
            終了日
            <DateField aria-label="終了日" value={typeof condition.value === 'object' && condition.value ? String((condition.value as { to?: string }).to ?? '') : ''} onChange={(v) => onChange({ ...condition, op: 'between', value: { ...(typeof condition.value === 'object' ? condition.value : {}), to: v } })} className="mt-1" />
          </label>
        </div>
      ) : (
        <TextInput value={rawValue} onChange={(event) => onChange({ ...condition, value: event.target.value })} placeholder="値を入力" className="min-w-44 flex-1" />
      )}

      <Button type="button" onClick={onDelete}>削除</Button>
    </div>
  )
}

function ConditionGroup({
  title,
  operator,
  items,
  tags,
  marks,
  scenarios,
  fields,
  referenceErrors,
  onChange,
}: {
  title: string
  operator: 'AND' | 'OR'
  items: SavedSearchCondition[]
  tags: Tag[]
  marks: SupportMark[]
  scenarios: Scenario[]
  fields: FriendField[]
  referenceErrors: { marks: boolean; scenarios: boolean; fields: boolean }
  onChange: (next: SavedSearchCondition[]) => void
}) {
  return (
    <section className="rounded-card border border-hairline bg-canvas p-4 shadow-card">
      <h2 className="text-base font-bold text-ink">{title}（{operator}）</h2>
      {items.length === 0 ? <p className="mt-2 text-xs text-ink-faint">条件はまだありません。必要な場合だけ追加します。</p> : null}
      <div className="mt-3 space-y-2">
        {/*
          行のキーは位置で固定する。種類＋添字にすると、種類を変えた
          行が作り直されて入力内容・フォーカスが飛ぶ。保存する条件の
          形は変えていない(並び替え操作は無い)。
        */}
        {items.map((condition, index) => (
          <ConditionEditor
            key={`condition-${index}`}
            condition={condition}
            tags={tags}
            marks={marks}
            scenarios={scenarios}
            fields={fields}
            referenceErrors={referenceErrors}
            onChange={(next) => onChange(items.map((item, itemIndex) => itemIndex === index ? next : item))}
            onDelete={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
          />
        ))}
      </div>
      <Button type="button" onClick={() => onChange([...items, defaultCondition(tags)])} className="mt-3">＋ {operator}条件を追加</Button>
    </section>
  )
}

function SavedSearchEditInner() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const { selectedAccountId, selectedAccount } = useAccount()
  const [original, setOriginal] = useState<SavedSearchDetail | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [marks, setMarks] = useState<SupportMark[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [fields, setFields] = useState<FriendField[]>([])
  const [referenceErrors, setReferenceErrors] = useState({ marks: false, scenarios: false, fields: false })
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

  /*
    ATTR-12: 再計算の連打・条件変更・アカウント切替で、古い計算結果が
    新しい条件の人数を上書きしてはいけない。要求ごとに世代の印を取り、
    応答時に「いまの条件の要求か」「いまのアカウントか」を照合する。
  */
  const gateRef = useRef(createResponseGate())
  const accountRef = useRef(selectedAccountId)
  accountRef.current = selectedAccountId

  useEffect(() => {
    gateRef.current.invalidate()
  }, [selectedAccountId])

  const recount = useCallback(async () => {
    if (!selectedAccountId || !id) return
    const account = selectedAccountId
    const token = gateRef.current.begin()
    setPreviewError('')
    try {
      const res = await api.savedSearches.preview(account, { savedSearchId: id, conditions, revision: original?.revision })
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
    let cancelled = false
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
      api.tags.list(),
      api.supportMarks.list(selectedAccountId, { suppressFeatureDisabledEvent: true }).catch(() => null),
      api.scenarios.list({ accountId: selectedAccountId }).catch(() => null),
      api.friendFields.list(selectedAccountId, undefined, { suppressFeatureDisabledEvent: true }).catch(() => null),
    ]).then(([detail, searches, tagResult, markResult, scenarioResult, fieldResult]) => {
      if (cancelled) return
      if (tagResult.success) setTags(tagResult.data)
      setMarks(markResult?.success ? markResult.data : [])
      setScenarios(scenarioResult?.success ? scenarioResult.data : [])
      setFields(fieldResult?.success ? fieldResult.data : [])
      setReferenceErrors({
        marks: markResult?.success !== true,
        scenarios: scenarioResult?.success !== true,
        fields: fieldResult?.success !== true,
      })
      setSavedCount(searches.success ? searches.summary.total : null)
      setSiblingSearches(searches.success ? searches.items.map((item) => ({ id: item.id, name: item.name })) : [])
      const found = detail.success ? detail.data : null
      if (!found) {
        setError('保存した検索が見つかりません')
        setSearchMissing(true)
        return
      }
      setOriginal(found)
      setName(found.name)
      setConditions(normalizeForEdit(found))
      setIsShared(found.isShared)
      setPreviewCount(found.matchCount ?? null)
      setPreview(found.match)
      /* IDEA-04: 計算に失敗している保存値を「計算済み」の時点付きで見せない。 */
      setPreviewError(found.match.error ?? '')
    }).catch((caught: unknown) => {
      if (cancelled) return
      if (caught instanceof ApiError && caught.status === 404) {
        setError('保存した検索が見つかりません')
        setSearchMissing(true)
      } else {
        setError('保存した検索を読み込めませんでした')
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
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
  }), [marks, scenarios, fields])
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
      setConditions(normalizeForEdit(refreshed.data))
      setPreviewStale(false)
      await recount()
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

  return (
    <div data-design-node="XBkiQ">
      <div className="mb-4 flex items-center justify-between gap-4">
        <Breadcrumb items={[{ label: '保存した検索', href: '/tags?tab=searches' }, { label: original.name }]} />
        <Button href="/tags?tab=searches">保存した検索へ</Button>
      </div>

      {error ? <p role="alert" className="mb-4 rounded-control border border-status-danger-border bg-status-danger-soft p-3 text-sm text-danger">{error}</p> : null}

      {/*
        ATTR-16: グリッド子は `min-w-0` で縮める。無いと中身の最小幅が
        そのまま段の最小幅になり、390pxで右端が画面の外へ出る。
      */}
      <div className="grid min-w-0 gap-4 xl:grid-cols-4">
        <div className="min-w-0 space-y-4 xl:col-span-3">
          <section className="rounded-card border border-hairline bg-canvas p-4 shadow-card">
            <h2 className="text-base font-bold text-ink">条件名・説明</h2>
            <div className="mt-3 grid gap-3">
              <div>
                <TextInput value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className="max-w-xl" aria-label="条件名" />
                {/* IDEA-04: 同名の検索がすでにあるとき、保存する前に知らせる。 */}
                <DuplicateNameNote duplicates={nameDuplicates} kindLabel="保存した検索" />
              </div>
              <TextInput value={conditions.description ?? ''} maxLength={300} onChange={(event) => patchConditions({ ...conditions, description: event.target.value })} placeholder="この検索を使う目的" className="max-w-xl" aria-label="説明" />
            </div>
            <fieldset className="mt-4">
              <legend className="text-xs font-semibold text-ink-faint">共有範囲</legend>
              {/* ATTR-16: 狭い画面では縦に折り返す。横に伸ばして画面をはみ出させない。 */}
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-secondary">
                <label className="flex items-center gap-2"><input type="radio" checked={isShared} onChange={() => setIsShared(true)} /> 全員（他の担当者からも使えます）</label>
                <label className="flex items-center gap-2"><input type="radio" checked={!isShared} onChange={() => setIsShared(false)} /> 自分だけ</label>
              </div>
              {/*
                設計 `XBkiQ`：共有範囲を選ぶ場所で、上限と「共有すると何が
                起きるか」を先に言う。50件に近づいてから初めて知る、という
                順番にしない。件数は一覧の取得結果そのものなので、読めて
                いないときは数を出さずに上限だけ書く。
              */}
              <p className="mt-2 text-xs leading-5 text-ink-faint">
                {savedCount === null
                  ? '保存できるのは50件までです。'
                  : `保存できるのは50件までです（いま${savedCount}件）。`}
                共有すると、一斉配信・オートメーションの対象条件からも呼び出せます。
              </p>
            </fieldset>
            {/* IDEA-04: 条件の保存は「保存した検索」。印ならタグ・値なら情報欄という違いを、編集の場所でも確認できるようにする。 */}
            <div className="mt-4"><AttributeKindGuide current="search" /></div>
          </section>

          <ConditionGroup title="すべて満たす" operator="AND" items={conditions.all ?? []} tags={tags} marks={marks} scenarios={scenarios} fields={fields} referenceErrors={referenceErrors} onChange={(all) => patchConditions({ ...conditions, all })} />
          <ConditionGroup title="いずれか1つ以上満たす" operator="OR" items={conditions.any ?? []} tags={tags} marks={marks} scenarios={scenarios} fields={fields} referenceErrors={referenceErrors} onChange={(any) => patchConditions({ ...conditions, any })} />
        </div>

        <aside className="min-w-0 space-y-4">
          <section className="rounded-card border border-hairline bg-canvas p-4 shadow-card">
            <h2 className="text-base font-bold text-ink">該当プレビュー</h2>
            {/* 監査6 #674: 24px超の数字は字詰め（large → tracking -0.02em）と単位小を MetricValue で揃える */}
            <p className="mt-3 text-3xl font-bold text-ink"><MetricValue value={previewCount} unit="人" large /></p>
            {/*
              IDEA-04: 人数をいつ・どの条件で計ったかを出す。
              条件を変えたあとは、出ている人数が「変更前の条件」のもので
              「変更後の条件」は未計算だと分かるようにする。取れていない
              ときは計算時点を出さない（推定で埋めない）。
            */}
            <p className="mt-1 text-micro text-ink-faint">
              {previewError || preview?.error
                ? '未計算'
                : preview?.calculatedAt
                  ? `${new Date(preview.calculatedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}に計算`
                  : '未計算'}
            </p>
            {previewError ? (
              <p role="alert" className="mt-2 text-xs text-danger">{previewError}</p>
            ) : previewStale ? (
              <div className="mt-2 rounded-control border border-warning/30 bg-warning-bg p-2 text-xs leading-5 text-status-warn-deep">
                <p className="font-semibold">条件を変更しました。上の人数は変更前の条件のもので、変更後の条件は未計算です。</p>
                <p className="mt-1"><span className="font-semibold">変更前：</span>{beforeSummary.length ? beforeSummary.join('・') : '条件なし'}</p>
                <p className="mt-1"><span className="font-semibold">変更後：</span>{afterSummary.length ? afterSummary.join('・') : '条件なし'}</p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-ink-faint">{preview ? `LINE ${preview.byChannel.line ?? '—'}人・MAIL ${preview.byChannel.mail ?? '—'}人` : '保存済み条件で集計'}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2"><Button type="button" onClick={() => void recount()}>人数を再計算</Button><Button href={`/friends?savedSearch=${encodeURIComponent(id)}`} variant="primary">該当者を確認</Button></div>
          </section>

          <section className="rounded-card border border-hairline bg-canvas p-4 shadow-card">
            <h2 className="text-base font-bold text-ink">使うときの参照の仕方</h2>
            <div className="mt-3 space-y-2 text-sm text-ink-secondary"><p><strong className="text-ink">ライブ参照</strong>　使うたびに条件で数え直し、人の出入りを反映します。</p><p><strong className="text-ink">固定</strong>　保存した時点の人を使い、あとから条件を変えても対象は変えません。</p></div>
            <p className="mt-3 rounded-control bg-warning-bg p-3 text-xs text-warning">{original.usedIn?.some((usage) => usage.mode === 'live') ? 'ライブ参照の使用先は、条件を変えると次回実行から対象が変わります。' : '現在、ライブ参照の使用先はありません。'}</p>
          </section>

          <section className="rounded-card border border-hairline bg-canvas p-4 shadow-card">
            <h2 className="text-base font-bold text-ink">この条件の使用先</h2>
            {original.usedIn === undefined ? (
              <p className="mt-3 text-sm text-ink-faint">—</p>
            ) : original.usedIn.length === 0 ? (
              <p className="mt-3 text-sm font-semibold text-ink-secondary">使用先はありません</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm text-ink-secondary">
                {original.usedIn.map((usage) => (
                  <li key={`${usage.kind}:${usage.id}`} className="rounded-control bg-status-warn-soft p-2">
                    <span className="font-bold">{USAGE_KIND_LABELS[usage.kind]}</span>
                    <span className="ml-1">{usage.name}</span>
                    <span className="ml-1 text-xs text-ink-faint">{usage.mode === 'live' ? '条件を自動反映' : '固定した条件'}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs leading-5 text-ink-faint">使用先がある検索は、先に参照を外すまで削除できません。</p>
          </section>

          <section className="rounded-card border border-hairline bg-canvas p-4 shadow-card">
            <h2 className="text-base font-bold text-ink">一覧での表示</h2>
            <label className="mt-3 block text-xs font-semibold text-ink-faint">並び順
              <Select aria-label="並び順" value={conditions.list?.sort ?? 'recent'} onChange={(value) => patchConditions({ ...conditions, list: { ...conditions.list, sort: value as 'recent' | 'oldest' } })} options={[{ value: 'recent', label: '最終接触が新しい順' }, { value: 'oldest', label: '最終接触が古い順' }]} size="full" className="mt-1" />
            </label>
            <label className="mt-3 block text-xs font-semibold text-ink-faint">表示件数
              <Select aria-label="表示件数" value={String(conditions.list?.limit ?? 20)} onChange={(value) => patchConditions({ ...conditions, list: { ...conditions.list, limit: Number(value) as 10 | 20 | 30 | 40 | 50 } })} options={[10, 20, 30, 40, 50].map((size) => ({ value: String(size), label: `${size}件表示` }))} size="full" className="mt-1" />
            </label>
            <p className="mt-3 rounded-control border border-hairline bg-surface-pearl p-2 text-xs text-ink-secondary">表示列：{conditions.list?.columns?.join('・') || '名前・タグ・担当者'}</p>
          </section>
        </aside>
      </div>

      <StickyBar
        destructive={<button type="button" disabled={original.canDelete !== true} onClick={() => setDeleteOpen(true)} title={original.canDelete === true ? 'この条件を削除' : original.usedIn === undefined ? '使用先を確認できないため削除できません' : original.usedIn.length > 0 ? `使用中のため削除できません（${original.usedIn.length}件）` : '削除できるか確認できません'} className="rounded-control bg-danger px-4 py-2 text-sm font-bold text-on-accent disabled:cursor-not-allowed disabled:opacity-40">この条件を削除</button>}
        actions={(
          <>
            <Button href="/tags?tab=searches">キャンセル</Button>
            <Button type="button" disabled={saving} onClick={() => void duplicate()}>複製して保存</Button>
            <Button type="button" variant="primary" disabled={saving || !dirty} onClick={() => void save()}>{saving ? '保存中…' : '変更を保存'}</Button>
          </>
        )}
      />
      <ConfirmDialog open={deleteOpen && original.canDelete === true} title={`「${name}」を削除しますか？`} description="使用先が無いことをサーバーで確認済みです。保存した条件だけを削除し、友だちは削除しません。" confirmLabel="削除する" destructive onCancel={() => setDeleteOpen(false)} onConfirm={() => { setDeleteOpen(false); void remove() }} />
      <ConfirmDialog
        open={leaveTarget !== null}
        title="保存していない変更があります"
        description="このまま移動すると、検索条件への変更は失われます。保存せずに移動しますか？"
        confirmLabel="保存せずに移動"
        cancelLabel="編集を続ける"
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
    </div>
  )
}

export default function SavedSearchEditPage() {
  return <FeatureGate feature="saved_searches"><Suspense fallback={<p className="text-sm text-ink-faint">読み込んでいます</p>}><SavedSearchEditInner /></Suspense></FeatureGate>
}

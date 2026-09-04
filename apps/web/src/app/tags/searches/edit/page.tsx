'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
import { api, ApiError } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Breadcrumb from '@/components/layout/breadcrumb'
import StickyBar from '@/components/shared/sticky-bar'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { TextInput } from '@/components/shared/form-controls'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import { optionsWithCurrent } from './reference-options'

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

function conditionProblem(condition: SavedSearchCondition): string | null {
  if (UNSUPPORTED_KINDS.has(condition.kind)) return '未接続の条件を削除してください'
  if (condition.kind === 'following') return typeof condition.value === 'boolean' ? null : '友だち状態を選んでください'
  if (condition.kind === 'created_at') {
    const range = condition.value && typeof condition.value === 'object'
      ? condition.value as { from?: unknown; to?: unknown }
      : null
    return range && (range.from || range.to) ? null : '友だち追加日を入力してください'
  }
  if (condition.kind === 'field' && !condition.key?.trim()) return '友だち情報の項目名を入力してください'
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
          <Select aria-label="友だち情報の比較" value={condition.op} onChange={(op) => onChange({ ...condition, op })} options={[{ value: 'eq', label: '等しい' }, { value: 'ne', label: '等しくない' }, { value: 'contains', label: '含む' }]} className="w-32" />
          <TextInput value={rawValue} onChange={(event) => onChange({ ...condition, value: event.target.value })} placeholder="値" className="min-w-40 flex-1" />
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
        <div className="flex min-w-80 flex-1 items-center gap-2">
          <TextInput type="date" value={typeof condition.value === 'object' && condition.value ? String((condition.value as { from?: string }).from ?? '') : ''} onChange={(event) => onChange({ ...condition, op: 'between', value: { ...(typeof condition.value === 'object' ? condition.value : {}), from: event.target.value } })} className="flex-1" />
          <span className="text-ink-faint">〜</span>
          <TextInput type="date" value={typeof condition.value === 'object' && condition.value ? String((condition.value as { to?: string }).to ?? '') : ''} onChange={(event) => onChange({ ...condition, op: 'between', value: { ...(typeof condition.value === 'object' ? condition.value : {}), to: event.target.value } })} className="flex-1" />
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
        {items.map((condition, index) => (
          <ConditionEditor
            key={`${condition.kind}-${index}`}
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
  const { selectedAccountId } = useAccount()
  const [original, setOriginal] = useState<SavedSearch | null>(null)
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
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewStale, setPreviewStale] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)

  usePageTitle('保存した検索を編集')

  const recount = useCallback(async () => {
    if (!selectedAccountId || !id) return
    try {
      const res = await api.friends.list({ accountId: selectedAccountId, savedSearchId: id, limit: 1, includeTags: false })
      setPreviewCount(res.success ? res.data.total : null)
    } catch {
      setPreviewCount(null)
    }
  }, [id, selectedAccountId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    if (!selectedAccountId || !id) {
      setLoading(false)
      return
    }
    void Promise.all([
      api.savedSearches.list(selectedAccountId),
      api.tags.list(),
      api.supportMarks.list(selectedAccountId).catch(() => null),
      api.scenarios.list({ accountId: selectedAccountId }).catch(() => null),
      api.friendFields.list(selectedAccountId).catch(() => null),
    ]).then(([searches, tagResult, markResult, scenarioResult, fieldResult]) => {
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
      setSavedCount(searches.success ? searches.data.length : null)
      const found = searches.success ? searches.data.find((item) => item.id === id) ?? null : null
      if (!found) {
        setError('保存した検索が見つかりません')
        return
      }
      setOriginal(found)
      setName(found.name)
      setConditions(normalizeForEdit(found))
      setIsShared(found.isShared)
      void recount()
    }).catch(() => {
      if (!cancelled) setError('保存した検索を読み込めませんでした')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [id, recount, selectedAccountId])

  const dirty = useMemo(() => {
    if (!original) return false
    return name !== original.name || isShared !== original.isShared
      || JSON.stringify(conditions) !== JSON.stringify(normalizeForEdit(original))
  }, [conditions, isShared, name, original])

  const patchConditions = (next: SavedSearchConditions) => {
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
      const res = await api.savedSearches.update(id, selectedAccountId, { name: name.trim(), conditions, isShared })
      if (!res.success) { setError(res.error); return }
      setOriginal(res.data)
      setConditions(normalizeForEdit(res.data))
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
      if (res.success) router.push(`/tags/searches/edit?id=${encodeURIComponent(res.data.id)}`)
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
  if (!selectedAccountId) return <p className="rounded-card border border-hairline bg-canvas p-5 text-sm text-ink-secondary">上部でLINE公式アカウントを選んでください。</p>
  if (!original) return <p className="rounded-card border border-hairline bg-canvas p-5 text-sm text-danger">{error || '保存した検索が見つかりません'}</p>

  return (
    <div data-design-node="XBkiQ" className="pb-24">
      <div className="mb-4 flex items-center justify-between gap-4">
        <Breadcrumb items={[{ label: '保存した検索', href: '/tags?tab=searches' }, { label: original.name }]} />
        <Button href="/tags?tab=searches">保存した検索へ</Button>
      </div>

      {error ? <p role="alert" className="mb-4 rounded-control border border-status-danger-border bg-status-danger-soft p-3 text-sm text-danger">{error}</p> : null}

      <div className="grid gap-4 xl:grid-cols-4">
        <div className="space-y-4 xl:col-span-3">
          <section className="rounded-card border border-hairline bg-canvas p-4 shadow-card">
            <h2 className="text-base font-bold text-ink">条件名・説明</h2>
            <div className="mt-3 grid gap-3">
              <TextInput value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className="max-w-xl" aria-label="条件名" />
              <TextInput value={conditions.description ?? ''} maxLength={300} onChange={(event) => patchConditions({ ...conditions, description: event.target.value })} placeholder="この検索を使う目的" className="max-w-xl" aria-label="説明" />
            </div>
            <fieldset className="mt-4">
              <legend className="text-xs font-semibold text-ink-faint">共有範囲</legend>
              <div className="mt-2 flex gap-6 text-sm text-ink-secondary">
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
          </section>

          <ConditionGroup title="すべて満たす" operator="AND" items={conditions.all ?? []} tags={tags} marks={marks} scenarios={scenarios} fields={fields} referenceErrors={referenceErrors} onChange={(all) => patchConditions({ ...conditions, all })} />
          <ConditionGroup title="いずれか1つ以上満たす" operator="OR" items={conditions.any ?? []} tags={tags} marks={marks} scenarios={scenarios} fields={fields} referenceErrors={referenceErrors} onChange={(any) => patchConditions({ ...conditions, any })} />
        </div>

        <aside className="space-y-4">
          <section className="rounded-card border border-hairline bg-canvas p-4 shadow-card">
            <h2 className="text-base font-bold text-ink">該当プレビュー</h2>
            <p className="mt-3 text-3xl font-bold tabular-nums text-ink">{previewCount === null ? '—' : `${previewCount.toLocaleString('ja-JP')}人`}</p>
            <p className="mt-2 text-xs text-ink-faint">{previewStale ? '変更を保存すると再計算します' : '保存済み条件で集計'}</p>
            <Button href={`/friends?savedSearch=${encodeURIComponent(id)}`} variant="primary" className="mt-3">該当者を確認</Button>
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
        destructive={<button type="button" disabled={original.canDelete !== true} onClick={() => setDeleteOpen(true)} title={original.canDelete === true ? 'この条件を削除' : original.usedIn === undefined ? '使用先を確認できないため削除できません' : original.usedIn.length > 0 ? `使用中のため削除できません（${original.usedIn.length}件）` : '削除できるか確認できません'} className="rounded-control bg-status-danger px-4 py-2 text-sm font-bold text-on-accent disabled:cursor-not-allowed disabled:opacity-40">この条件を削除</button>}
        actions={(
          <>
            <Button href="/tags?tab=searches">キャンセル</Button>
            <Button type="button" disabled={saving} onClick={() => void duplicate()}>複製して保存</Button>
            <Button type="button" variant="primary" disabled={saving || !dirty} onClick={() => void save()}>{saving ? '保存中…' : '変更を保存'}</Button>
          </>
        )}
      />
      <ConfirmDialog open={deleteOpen && original.canDelete === true} title={`「${name}」を削除しますか？`} description="使用先が無いことをサーバーで確認済みです。保存した条件だけを削除し、友だちは削除しません。" confirmLabel="削除する" destructive onCancel={() => setDeleteOpen(false)} onConfirm={() => { setDeleteOpen(false); void remove() }} />
    </div>
  )
}

export default function SavedSearchEditPage() {
  return <Suspense fallback={<p className="text-sm text-ink-faint">読み込んでいます</p>}><SavedSearchEditInner /></Suspense>
}

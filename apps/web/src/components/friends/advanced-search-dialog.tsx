'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SavedSearchCondition, Scenario, Tag } from '@line-crm/shared'
import { api, type FriendListParams } from '@/lib/api'
import {
  conditionsToEditorState,
  describeSavedCondition,
  describeSavedVisibility,
  editorStateToConditions,
  hasSavedSearchFilter,
  type FriendSearchBlock,
  type FriendSearchEditorState,
  type FriendVisibilityChoice,
  type SavedSearchConditionLabels,
} from './saved-search-utils'
import { TextInput } from '@/components/shared/form-controls'
import Button from '@/components/shared/button'

/**
 * V4の詳細検索。既存APIが受け取れる条件だけを実行対象にする。
 *
 * これまで「詳細検索」は押せないボタンだった。条件を組み立てて渡す口が
 * 無かったため。`/api/friends` に足し算の絞り込みを入れたので、
 * **受け口のあるものだけ**を組み立てられるようにする。
 *
 * 受け口が無い条件は、押せない札として並べて理由を出す。隠すと
 * 「作り忘れ」に見えるし、押せるようにすると黙って無視される。
 */

/** 絞り込みの1ブロック。設計の「条件」1つぶん。 */
type Block = FriendSearchBlock

const BLOCK_LABEL: Record<Block['kind'], string> = {
  name: '名前',
  tag: 'タグ',
  field: '友だち情報',
  status_message: 'ステータスメッセージ',
  created_at: '友だち登録日',
  chat_status: '対応状況',
}

const BLOCK_HELP: Record<Block['kind'], string> = {
  name: 'LINE登録名・本名・システム表示名',
  tag: '含む／含まない',
  field: '項目と値',
  status_message: 'ひとことに含む文字',
  created_at: '期間を指定',
  chat_status: '固定の4状態',
}

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const

const VISIBILITY_OPTIONS: Array<{ value: FriendVisibilityChoice; label: string }> = [
  { value: 'visible', label: '表示中' },
  { value: 'hidden', label: '非表示のみ' },
  { value: 'blocked', label: 'ブロックした人' },
  { value: 'all', label: 'すべて' },
]

/*
 * FRIEND-03: ORの軸は「項目→比較方法→値」を自分で選ぶ。
 * 先頭の候補や固定の日付を勝手に使うと、選んだ覚えのない条件で
 * 絞り込まれる。値が要る軸は入力が揃うまで「追加」を押せない。
 */
type OrAxisInput = 'mark' | 'scenario' | 'date' | 'text' | null
const OR_AXES: Array<{
  label: string
  feature?: 'support_marks'
  input: OrAxisInput
  placeholder?: string
  make: (value: string) => SavedSearchCondition | null
}> = [
  { label: '対応マーク', feature: 'support_marks', input: 'mark', make: (value) => value ? { kind: 'mark', op: 'eq', value } : null },
  { label: 'シナリオ', input: 'scenario', make: (value) => value ? { kind: 'scenario', op: 'eq', value } : null },
  { label: 'イベント予約', input: null, make: () => ({ kind: 'event_booking', op: 'exists' }) },
  { label: 'カレンダー予約', input: null, make: () => ({ kind: 'calendar_booking', op: 'exists' }) },
  { label: '回答フォーム', input: null, make: () => ({ kind: 'form', op: 'exists' }) },
  { label: '最終反応日', input: 'date', make: (value) => value ? { kind: 'last_activity', op: 'after', value } : null },
  { label: 'リマインダ', input: null, make: () => ({ kind: 'reminder', op: 'exists' }) },
  { label: '個別メモ', input: null, make: () => ({ kind: 'memo', op: 'exists' }) },
  { label: 'ステータスメッセージ', input: 'text', placeholder: '含む文字', make: (value) => value.trim() ? { kind: 'status_message', op: 'contains', value: value.trim() } : null },
  { label: '友だち登録日', input: 'date', make: (value) => value ? { kind: 'created_at', op: 'after', value } : null },
  { label: 'その他', input: 'text', placeholder: 'イベント種別（例：conversion）', make: (value) => value.trim() ? { kind: 'common_event', op: 'exists', value: value.trim() } : null },
]

export interface AdvancedSearchResult {
  params: Pick<
    FriendListParams,
    | 'search'
    | 'tagIds'
    | 'excludeTagIds'
    | 'metadata'
    | 'metadataNot'
    | 'statusMessage'
    | 'createdFrom'
    | 'createdTo'
    | 'chatStatus'
    | 'visibility'
    | 'sort'
    | 'limit'
    | 'savedSearchId'
    | 'conditions'
  >
  /** 画面に「絞り込み中」を出すための、人が読める形 */
  summary: string[]
  /**
   * 詳細条件をもう一度開いたとき、この編集状態から再開する（FRIEND-32）。
   * URL直指定の保存検索など実条件が手元に無い適用では未設定のままにし、
   * 開いたときに保存済み一覧から引き直す。
   */
  editorState?: FriendSearchEditorState
}

function defaultBlocks(fieldsEnabled: boolean): Block[] {
  const blocks: Block[] = [
    { kind: 'name', keyword: '' },
    { kind: 'tag', include: [], exclude: [] },
  ]
  if (fieldsEnabled) blocks.push({ kind: 'field', key: '', op: 'eq', value: '' })
  return blocks
}

export default function AdvancedSearchDialog({
  open,
  accountId,
  tags,
  fieldNames,
  marks,
  scenarios,
  onClose,
  onLoadSaved,
  onApply,
  features,
  applied,
  initialSort,
  initialLimit,
}: {
  open: boolean
  accountId: string | null
  tags: Tag[]
  /** 友だち情報の項目名。取れないときは空でよい（自由入力にする）。 */
  fieldNames: string[]
  marks: Array<{ id: string; name: string }>
  scenarios: Scenario[]
  onClose: () => void
  onLoadSaved?: () => void
  onApply: (result: AdvancedSearchResult) => void
  /** 機能設定でオフの入口は出さない。未指定は従来どおり全部出す。 */
  features?: { savedSearch?: boolean; marks?: boolean; fields?: boolean }
  /**
   * 現在適用中の条件。開いたときこの編集状態から再開する。
   * 保存した検索の適用後は、保存された実条件を復元した状態が入る。
   */
  applied?: AdvancedSearchResult | null
  /** 一覧の現在の並び順・表示件数。開いたときの初期値にする。 */
  initialSort: 'recent' | 'oldest'
  initialLimit: number
}) {
  const savedSearchEnabled = features?.savedSearch !== false
  const marksFeatureEnabled = features?.marks !== false
  const fieldsFeatureEnabled = features?.fields !== false
  const [blocks, setBlocks] = useState<Block[]>(() => defaultBlocks(fieldsFeatureEnabled))
  const [visibility, setVisibility] = useState<FriendVisibilityChoice>('visible')
  const [any, setAny] = useState<SavedSearchCondition[]>([])
  const [extraAll, setExtraAll] = useState<SavedSearchCondition[]>([])
  const [sort, setSort] = useState<'recent' | 'oldest'>(initialSort)
  const [limit, setLimit] = useState<number>(initialLimit)
  const [count, setCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)
  const [countFailed, setCountFailed] = useState(false)
  const countRequestRef = useRef(0)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [savedNotice, setSavedNotice] = useState('')

  /** IDや内部名を画面へ出さないための、ID→表示名の辞書。 */
  const labels = useMemo<SavedSearchConditionLabels>(() => ({
    marks: Object.fromEntries(marks.map((mark) => [mark.id, mark.name])),
    scenarios: Object.fromEntries(scenarios.map((scenario) => [scenario.id, scenario.name])),
  }), [marks, scenarios])

  const editorState = useMemo<FriendSearchEditorState>(
    () => ({ blocks, any, extraAll, visibility }),
    [blocks, any, extraAll, visibility],
  )

  /*
   * FRIEND-32: 開くたびに「今適用されている条件」から再開する。
   * 保存した検索の適用直後に開いても、保存条件がブロックへ復元される。
   * 開いている途中で props が変わっても入力中の状態を捨てないよう、
   * 閉→開の切り替わりの時だけ初期化する。
   */
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const state = applied?.editorState
      setBlocks(state?.blocks ?? defaultBlocks(fieldsFeatureEnabled))
      setAny(state?.any ?? [])
      setExtraAll(state?.extraAll ?? [])
      setVisibility(state?.visibility ?? 'visible')
      setSort(initialSort)
      setLimit(PAGE_SIZE_OPTIONS.includes(initialLimit as (typeof PAGE_SIZE_OPTIONS)[number]) ? initialLimit : 20)
      setSavedNotice('')
      setCountFailed(false)
    }
    wasOpenRef.current = open
  }, [open, applied, fieldsFeatureEnabled, initialSort, initialLimit])

  /*
   * ?savedSearch= の直URLなど、IDだけ分かって実条件が手元に無い適用は、
   * 開いたときに保存済み一覧から同じIDの条件を引いて復元する。
   * 見つからなければ空の編集画面のままにし、黙って別条件にしない。
   */
  useEffect(() => {
    const savedId = applied?.params.savedSearchId
    if (!open || !savedId || applied?.editorState || !accountId || !savedSearchEnabled) return
    let cancelled = false
    void api.friendSavedViews.list(accountId, { suppressFeatureDisabledEvent: true }).then((res) => {
      if (cancelled || !res.success) return
      const found = res.data.items.find((view) => view.id === savedId)
      if (!found) return
      const state = conditionsToEditorState(found.conditions)
      setBlocks(state.blocks)
      setAny(state.any)
      setExtraAll(state.extraAll)
      setVisibility(state.visibility)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [open, applied, accountId, savedSearchEnabled])

  const params = useMemo<AdvancedSearchResult['params']>(() => {
    /*
     * FRIEND-32: 保存した検索から開いて何も変えずに適用し直すときは、
     * savedSearchId をそのまま残す。条件の中身とIDの同時送信は受け口が
     * 拒否する。平たい引数も混ぜない —— ?search= は並び順を検索順位へ
     * 切り替えるので、保存検索の「新しい順/古い順」と食い違う。
     */
    const appliedSavedId = applied?.params.savedSearchId
    if (appliedSavedId
        && applied?.editorState !== undefined
        && JSON.stringify(editorState) === JSON.stringify(applied.editorState)) {
      return { savedSearchId: appliedSavedId, sort, limit }
    }
    const p: AdvancedSearchResult['params'] = { sort, limit }
    /*
     * 対象は2軸ある。一覧の ?visibility= は is_following（友だち中/ブロック）、
     * conditions.visibility は is_hidden（表示中/非表示）。1つの選択から
     * 両方へ意味の通る値だけを出す（FRIEND-01）。
     */
    if (visibility === 'visible') p.visibility = 'following'
    else if (visibility === 'blocked') p.visibility = 'blocked'
    for (const b of blocks) {
      if (b.kind === 'name' && b.keyword.trim()) p.search = b.keyword.trim()
      if (b.kind === 'tag') {
        if (b.include.length) p.tagIds = b.include
        if (b.exclude.length) p.excludeTagIds = b.exclude
      }
      if (b.kind === 'field' && fieldsFeatureEnabled && b.key.trim() && b.value.trim()) {
        const bag = b.op === 'eq' ? (p.metadata ??= {}) : (p.metadataNot ??= {})
        bag[b.key.trim()] = b.value.trim()
      }
      if (b.kind === 'status_message' && b.keyword.trim()) p.statusMessage = b.keyword.trim()
      if (b.kind === 'created_at') {
        if (b.from) p.createdFrom = b.from
        if (b.to) p.createdTo = b.to
      }
      if (b.kind === 'chat_status') p.chatStatus = b.value
    }
    /*
     * FRIEND-02: 同じ項目の条件が複数あっても全て残す。
     * 上の平たい引数（search 等）は1つしか入らない旧い受け口なので、
     * 実際の絞り込みは conditions が正本。画面・保存・件数は全部これを使う。
     *
     * FRIEND-01: 「すべて」で条件も無いときは conditions 自体を送らない。
     * 空の条件は受け口が弾くので、送らないことが「全員を見る」の正しい形。
     */
    const conditions = editorStateToConditions(editorState, { sort, limit })
    if (hasSavedSearchFilter(conditions)) {
      p.conditions = conditions
    }
    return p
  }, [blocks, editorState, visibility, sort, limit, fieldsFeatureEnabled, applied])

  const summary = useMemo(() => {
    const out: string[] = []
    /*
     * 対象（表示中/非表示/すべて）は常に見せる。条件と件数が食い違わないように。
     * 保存検索の無変更再適用では params が savedSearchId だけになるので、
     * params ではなく編集状態から説明を作る（FRIEND-32）。
     */
    out.push(`対象：${describeSavedVisibility(editorStateToConditions(editorState, { sort, limit }))}`)
    for (const b of blocks) {
      if (b.kind === 'name' && b.keyword.trim()) out.push(`名前に「${b.keyword.trim()}」`)
      if (b.kind === 'tag') {
        if (b.include.length) {
          out.push(`タグ ${b.include.map((id) => tags.find((t) => t.id === id)?.name ?? id).join('・')}`)
        }
        if (b.exclude.length) {
          out.push(`タグ以外 ${b.exclude.map((id) => tags.find((t) => t.id === id)?.name ?? id).join('・')}`)
        }
      }
      if (b.kind === 'field' && b.key.trim() && b.value.trim()) {
        out.push(`${b.key.trim()} が ${b.value.trim()}${b.op === 'ne' ? ' 以外' : ''}`)
      }
      if (b.kind === 'status_message' && b.keyword.trim()) out.push(`ひとこと「${b.keyword.trim()}」`)
      if (b.kind === 'created_at' && (b.from || b.to)) {
        out.push(`登録日 ${b.from || '…'} 〜 ${b.to || '…'}`)
      }
      if (b.kind === 'chat_status') {
        out.push(
          `対応状況 ${{ unread: '未対応', in_progress: '対応中', on_hold: '保留', resolved: '対応済み' }[b.value]}`,
        )
      }
    }
    for (const condition of extraAll) out.push(describeSavedCondition(condition, tags, labels))
    for (const condition of any) out.push(`OR: ${describeSavedCondition(condition, tags, labels)}`)
    return out
  }, [blocks, extraAll, any, tags, labels, editorState, sort, limit])

  /** 該当件数。押す前に何人になるかが分からないと、条件を組み立てられない。 */
  const recount = useCallback(async () => {
    /*
     * A03-02: 応答の世代を照合する。条件A→Bと素早く変えてAの応答が
     * 後から届いても、Bの件数をAで上書きしない。失敗は0件扱いせず
     * 「確認できません」と再試行を出す。
     */
    const requestId = ++countRequestRef.current
    setCounting(true)
    setCountFailed(false)
    try {
      // 件数だけ欲しいので1件だけ取る。total は絞り込み後の総数が返る。
      const res = await api.friends.list({ ...params, accountId: accountId ?? undefined, limit: 1, includeTags: false })
      if (requestId !== countRequestRef.current) return
      setCount(res.success ? res.data.total : null)
      setCountFailed(!res.success)
    } catch {
      if (requestId !== countRequestRef.current) return
      setCount(null)
      setCountFailed(true)
    } finally {
      if (requestId === countRequestRef.current) setCounting(false)
    }
  }, [accountId, params])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => void recount(), 400)
    return () => window.clearTimeout(timer)
  }, [open, recount])

  if (!open) return null

  const patch = (i: number, next: Block) =>
    setBlocks((prev) => prev.map((b, j) => (j === i ? next : b)))
  const drop = (i: number) => setBlocks((prev) => prev.filter((_, j) => j !== i))
  const add = (kind: Block['kind']) =>
    setBlocks((prev) => [
      ...prev,
      kind === 'name'
        ? { kind: 'name', keyword: '' }
        : kind === 'tag'
          ? { kind: 'tag', include: [], exclude: [] }
          : kind === 'field'
            ? { kind: 'field', key: '', op: 'eq', value: '' }
            : kind === 'status_message'
              ? { kind: 'status_message', keyword: '' }
              : kind === 'created_at'
                ? { kind: 'created_at', from: '', to: '' }
                : { kind: 'chat_status', value: 'unread' },
    ])

  const resetConditions = () => {
    /* FRIEND-01: リセットは初期状態（表示中・空の条件）へ戻す。 */
    setBlocks(defaultBlocks(fieldsFeatureEnabled))
    setAny([])
    setExtraAll([])
    setVisibility('visible')
  }

  const save = async () => {
    if (!accountId) {
      setSaveError('LINE公式アカウントを選んでください')
      return
    }
    if (!saveName.trim()) {
      setSaveError('条件名を入力してください')
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      /*
       * 保存は編集状態から直接 conditions を組み立てる。
       * 平たい引数へのフォールバックは「すべて」を visible_only へ
       * 書き換えてしまうので使わない（FRIEND-01/32）。
       */
      const res = await api.friendSavedViews.create(accountId, {
        name: saveName.trim(),
        conditions: editorStateToConditions(editorState, { sort, limit }),
        isShared: false,
      })
      if (!res.success) {
        setSaveError(res.error)
        return
      }
      setSaveName('')
      setSaveOpen(false)
      setSavedNotice('条件を保存しました')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '条件を保存できませんでした')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-scrim p-4"
      onClick={onClose}
    >
      <div
        /*
         * @container: パネル自身をコンテナにする。中の条件ブロックの
         * 組み換え（項目・比較方法・値の縦3段化）は、画面の幅ではなく
         * このパネルの幅で切り替える（#984 U011再）。
         */
        className="@container flex max-h-[calc(100vh-32px)] w-full max-w-3xl flex-col overflow-hidden rounded-panel border border-hairline bg-canvas shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-divider-soft px-6 py-5">
          <div>
            <h2 className="text-ink text-lg font-bold">絞り込み条件を設定</h2>
            <p className="text-ink-secondary mt-0.5 text-xs">
              条件を組み合わせて、対象の友だちだけを表示します。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="flex h-8 w-8 items-center justify-center rounded-control text-xl leading-none text-ink-faint hover:bg-canvas-sunken"
          >
            ×
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-6 py-4">
          <section className="rounded-panel border border-accent-border bg-accent-soft px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-micro font-medium text-accent-deep">現在の条件に一致</p>
                <p className="mt-0.5 text-xl font-bold tabular-nums text-accent-deep">
                  {counting ? '…' : count === null ? '—' : `${count.toLocaleString('ja-JP')}人`}
                </p>
              </div>
              {countFailed ? (
                <span className="flex items-center gap-2 text-micro text-danger">
                  件数を確認できません
                  <button
                    type="button"
                    onClick={() => void recount()}
                    className="font-semibold text-action underline"
                  >
                    再試行
                  </button>
                </span>
              ) : (
                <span className="text-micro text-accent-deep">自動で再計算</span>
              )}
            </div>
          </section>

          <section className="rounded-card border border-hairline bg-canvas p-3">
          <div className="flex items-center gap-2 px-1 pb-2">
            <span className="bg-accent-deep text-on-accent rounded-pill px-2 py-0.5 text-xs font-bold">
              AND
            </span>
            <span className="text-ink text-sm font-bold">すべて満たす条件</span>
          </div>

          {/* 友だち情報欄がオフのaccountでは、初期配置の field ブロックも出さない。 */}
          {blocks.map((b, i) => (b.kind === 'field' && !fieldsFeatureEnabled ? null : (
            <section
              key={`${b.kind}-${i}`}
              className="mb-2 grid items-center gap-3 rounded-card bg-canvas-sunken p-3 last:mb-0 sm:grid-cols-12"
            >
              <div className="sm:col-span-3">
                <h3 className="text-ink text-sm font-bold">{BLOCK_LABEL[b.kind]}</h3>
                <p className="text-ink-faint mt-0.5 text-nano">{BLOCK_HELP[b.kind]}</p>
              </div>

              <div className="min-w-0 sm:col-span-8">
                {b.kind === 'name' && (
                  <TextInput
                    value={b.keyword}
                    onChange={(e) => patch(i, { ...b, keyword: e.target.value })}
                    placeholder="キーワードを入力"
                    aria-label="名前のキーワード"
                  />
                )}

                {b.kind === 'tag' && (
                  <TagPicker
                    tags={tags}
                    include={b.include}
                    exclude={b.exclude}
                    onChange={(include, exclude) => patch(i, { ...b, include, exclude })}
                  />
                )}

                {b.kind === 'field' && (
                  /*
                   * #976 U087: 欄名・比較方法・値に常設ラベルを置く。
                   * placeholder だけだと、入力したあと「何の欄か」が残らない。
                   *
                   * #984 U011再: パネル幅が @3xl(768px) 未満では縦3段にして
                   * 各入力を全幅にする。画面幅ではなくパネル自身の幅で切り替える
                   * （パネルは直近の @container）。画面幅の sm: だと、狭い
                   * パネルの中で3列に押し込まれて1〜2文字しか見えなかった。
                   */
                  <div className="flex flex-col items-stretch gap-2 @3xl:flex-row @3xl:items-end">
                    <label className="min-w-0 @3xl:flex-1">
                      <span className="text-caption mb-1 block font-semibold text-ink-secondary">項目</span>
                      <TextInput
                        list="friend-field-names"
                        value={b.key}
                        onChange={(e) => patch(i, { ...b, key: e.target.value })}
                        placeholder="例：誕生日"
                      />
                    </label>
                    <datalist id="friend-field-names">
                      {fieldNames.map((n) => (
                        <option key={n} value={n} />
                      ))}
                    </datalist>
                    <label className="@3xl:shrink-0">
                      <span className="text-caption mb-1 block font-semibold text-ink-secondary">比較方法</span>
                      <select
                        value={b.op}
                        onChange={(e) => patch(i, { ...b, op: e.target.value as 'eq' | 'ne' })}
                        className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm @3xl:w-auto"
                      >
                        <option value="eq">等しい</option>
                        <option value="ne">等しくない</option>
                      </select>
                    </label>
                    <label className="min-w-0 @3xl:flex-1">
                      <span className="text-caption mb-1 block font-semibold text-ink-secondary">値</span>
                      <TextInput
                        value={b.value}
                        onChange={(e) => patch(i, { ...b, value: e.target.value })}
                        placeholder="例：1990-01-01"
                      />
                    </label>
                  </div>
                )}

                {b.kind === 'status_message' && (
                  <TextInput
                    value={b.keyword}
                    onChange={(e) => patch(i, { ...b, keyword: e.target.value })}
                    placeholder="ひとことに含む文字"
                    aria-label="ひとことに含む文字"
                  />
                )}

                {b.kind === 'created_at' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      value={b.from}
                      onChange={(e) => patch(i, { ...b, from: e.target.value })}
                      aria-label="友だち登録日の開始"
                      className="border-hairline rounded-control bg-canvas text-ink border px-3 py-2 text-sm"
                    />
                    <span className="text-ink-secondary text-sm">〜</span>
                    <input
                      type="date"
                      value={b.to}
                      onChange={(e) => patch(i, { ...b, to: e.target.value })}
                      aria-label="友だち登録日の終了"
                      className="border-hairline rounded-control bg-canvas text-ink border px-3 py-2 text-sm"
                    />
                  </div>
                )}

                {b.kind === 'chat_status' && (
                  <select
                    value={b.value}
                    onChange={(e) =>
                      patch(i, { ...b, value: e.target.value as 'unread' | 'in_progress' | 'on_hold' | 'resolved' })
                    }
                    aria-label="対応状況"
                    className="border-hairline rounded-control bg-canvas text-ink border px-3 py-2 text-sm"
                  >
                    {/* FRIEND-05: 説明どおり固定4状態。保留も検索できる。 */}
                    <option value="unread">未対応</option>
                    <option value="in_progress">対応中</option>
                    <option value="on_hold">保留</option>
                    <option value="resolved">対応済み</option>
                  </select>
                )}
              </div>

              <button
                type="button"
                onClick={() => drop(i)}
                aria-label={`${BLOCK_LABEL[b.kind]}の条件を外す`}
                className="text-danger text-xs hover:underline"
              >
                外す
              </button>
            </section>
          )))}

          <div className="mt-2 flex flex-wrap gap-2 px-1 pt-1">
              {(Object.keys(BLOCK_LABEL) as Block['kind'][]).filter((k) => k !== 'field' || fieldsFeatureEnabled).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => add(k)}
                  className="text-action rounded-control px-1 py-1 text-xs font-semibold hover:bg-action-soft"
                >
                  ＋ {BLOCK_LABEL[k]}
                </button>
              ))}
          </div>

          {/* 編集画面で組み直せない保存済み条件。黙って落とさず外せる形で残す（FRIEND-32）。 */}
          {extraAll.length > 0 ? (
            <div className="mt-2 space-y-2 px-1">
              <p className="text-nano text-ink-faint">保存されていたその他の条件</p>
              {extraAll.map((condition, index) => (
                <div key={`extra-${index}`} className="flex items-center justify-between rounded-control bg-canvas-sunken px-3 py-2 text-xs text-ink-secondary">
                  <span>{describeSavedCondition(condition, tags, labels)}</span>
                  <button
                    type="button"
                    onClick={() => setExtraAll((current) => current.filter((_, i) => i !== index))}
                  >
                    外す
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          </section>

          <section className="rounded-panel border border-hairline bg-canvas p-3">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-action px-2 py-0.5 text-xs font-bold text-on-action">OR</span>
              <span className="text-sm font-bold text-ink">いずれか1つ以上満たす条件</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              {OR_AXES.filter((item) => item.feature !== 'support_marks' || marksFeatureEnabled).map((item) => (
                <OrAxisPicker
                  key={item.label}
                  axis={item}
                  marks={marks}
                  scenarios={scenarios}
                  onAdd={(condition) => setAny((current) => [...current, condition])}
                />
              ))}
            </div>
            {any.length > 0 ? (
              <div className="mt-3 space-y-2">
                {/* FRIEND-03: 条件チップは実際の名前・日付を表示する。 */}
                {any.map((condition, index) => (
                  <div key={`${index}-${condition.kind}`} className="flex items-center justify-between rounded-control bg-action-soft px-3 py-2 text-xs text-action">
                    <span>{describeSavedCondition(condition, tags, labels)}</span>
                    <button type="button" onClick={() => setAny((current) => current.filter((_, itemIndex) => itemIndex !== index))}>外す</button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="rounded-panel border border-hairline bg-canvas p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-bold text-ink">表示する友だち</span>
              <span className="text-nano text-ink-faint">既定は「表示中」のみ</span>
            </div>
            {/*
              FRIEND-01: 対象は1か所で選ぶ。以前はチェックボックスと
              「対象」プルダウンの2か所が同じ変数へ別の意味で書き込み、
              「すべて」が非表示だけを検索していた。
            */}
            <div className="mt-2 flex flex-wrap gap-4 text-xs font-semibold text-ink-secondary" role="radiogroup" aria-label="表示する友だち">
              {VISIBILITY_OPTIONS.map((item) => (
                <label key={item.value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="friend-search-visibility"
                    checked={visibility === item.value}
                    onChange={() => setVisibility(item.value)}
                    className="h-4 w-4 accent-accent"
                  />
                  {item.label}
                </label>
              ))}
            </div>
            <label className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold text-ink-secondary">
              友だちの状態
              <select disabled className="min-w-64 rounded-control border border-hairline bg-canvas-sunken px-3 py-2 text-xs text-ink-faint">
                <option>このアカウントをブロックしていない</option>
              </select>
              <span className="text-nano font-normal text-ink-faint">相手側のブロック状態を絞る口の接続後に選べます</span>
            </label>
          </section>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="rounded-card border border-hairline bg-canvas px-3 py-2">
              <span className="text-nano text-ink-faint">並び順</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as 'recent' | 'oldest')}
                  className="mt-0.5 w-full border-0 bg-transparent p-0 text-xs font-semibold text-ink-secondary outline-none"
                >
                  <option value="recent">友だち追加の新しい順</option>
                  <option value="oldest">友だち追加の古い順</option>
                </select>
            </label>
            {/* FRIEND-04: 表示件数も条件の一部として適用する。 */}
            <label className="rounded-card border border-hairline bg-canvas px-3 py-2">
              <span className="text-nano text-ink-faint">表示件数</span>
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="mt-0.5 w-full border-0 bg-transparent p-0 text-xs font-semibold text-ink-secondary outline-none"
              >
                {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}件</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-divider-soft px-6 py-4">
          {onLoadSaved && savedSearchEnabled ? (
            <Button type="button" onClick={onLoadSaved}>
              保存した検索から読み込む
            </Button>
          ) : null}
          <button
            type="button"
            onClick={resetConditions}
            className="text-xs font-medium text-ink-faint hover:text-ink-secondary"
          >
            条件をリセット
          </button>
          <Button type="button" className="ml-auto" onClick={onClose}>
            キャンセル
          </Button>
          {savedNotice ? <span className="text-xs font-semibold text-accent-deep">{savedNotice}</span> : null}
          {savedSearchEnabled ? (
            <Button type="button" onClick={() => { setSaveOpen(true); setSaveError(''); setSavedNotice('') }}>条件を保存</Button>
          ) : null}
          {/* #976 U084: 主操作は共通Buttonの primary（`$accent-deep` + 白文字）。 */}
          <Button
            type="button"
            variant="primary"
            className="px-5"
            onClick={() => onApply({ params, summary, editorState })}
          >
            {counting ? '再計算中…' : count === null ? 'この条件で表示' : `${count.toLocaleString('ja-JP')}人を表示`}
          </Button>
        </div>
      </div>
      {saveOpen ? (
        <div className="fixed inset-0 z-110 flex items-center justify-center bg-scrim p-4" onClick={() => setSaveOpen(false)}>
          <section className="w-full max-w-md rounded-panel border border-hairline bg-canvas p-5 shadow-card" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-lg font-bold text-ink">この条件を保存</h3>
            <p className="mt-1 text-xs leading-5 text-ink-faint">保存後は「保存した検索」から何度でも呼び出せます。</p>
            <label className="mt-4 block text-sm font-semibold text-ink-secondary">
              条件名
              <TextInput autoFocus value={saveName} onChange={(event) => setSaveName(event.target.value)} maxLength={80} placeholder="例：VIPかつ未契約" className="mt-2" />
            </label>
            {saveError ? <p className="mt-3 text-sm text-danger">{saveError}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" onClick={() => setSaveOpen(false)}>キャンセル</Button>
              <Button type="button" variant="primary" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存する'}</Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

/**
 * ORの軸1つぶん。値が要る軸は入力が揃うまで追加できない（FRIEND-03）。
 * 先頭の候補・固定の日付を勝手に使うことはない。
 */
function OrAxisPicker({
  axis,
  marks,
  scenarios,
  onAdd,
}: {
  axis: (typeof OR_AXES)[number]
  marks: Array<{ id: string; name: string }>
  scenarios: Scenario[]
  onAdd: (condition: SavedSearchCondition) => void
}) {
  const [draft, setDraft] = useState('')
  const options = axis.input === 'mark' ? marks : axis.input === 'scenario' ? scenarios : []
  const waitingForOptions = (axis.input === 'mark' || axis.input === 'scenario') && options.length === 0
  const condition = axis.make(draft)
  const addable = !waitingForOptions && (axis.input === null || condition !== null)

  return (
    <div className="flex max-w-xs flex-col gap-1">
      <span className="text-xs font-semibold text-ink-secondary">{axis.label}</span>
      <div className="flex items-center gap-1.5">
        {axis.input === 'mark' || axis.input === 'scenario' ? (
          <select
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={waitingForOptions}
            aria-label={`${axis.label}を選ぶ`}
            className="border-hairline rounded-control bg-canvas text-ink min-w-0 flex-1 border px-2 py-1.5 text-xs disabled:opacity-50"
          >
            <option value="">選ぶ</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        ) : axis.input === 'date' ? (
          <input
            type="date"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={`${axis.label}の日付（この日以降）`}
            className="border-hairline rounded-control bg-canvas text-ink min-w-0 flex-1 border px-2 py-1.5 text-xs"
          />
        ) : axis.input === 'text' ? (
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={axis.placeholder}
            aria-label={`${axis.label}の値`}
            className="border-hairline rounded-control bg-canvas text-ink min-w-0 flex-1 border px-2 py-1.5 text-xs"
          />
        ) : null}
        <button
          type="button"
          disabled={!addable}
          onClick={() => {
            if (!condition) return
            onAdd(condition)
            setDraft('')
          }}
          className="shrink-0 rounded-full border border-divider-soft bg-canvas-sunken px-3 py-1.5 text-xs text-ink-secondary disabled:opacity-50"
        >
          ＋ 追加
        </button>
      </div>
      {waitingForOptions ? <span className="text-ink-faint text-nano leading-tight">選択肢を読み込むと使えます</span> : null}
      {axis.input === 'date' ? <span className="text-ink-faint text-nano leading-tight">指定した日以降</span> : null}
    </div>
  )
}

function TagPicker({
  tags,
  include,
  exclude,
  onChange,
}: {
  tags: Tag[]
  include: string[]
  exclude: string[]
  onChange: (include: string[], exclude: string[]) => void
}) {
  const [pick, setPick] = useState('')
  const [mode, setMode] = useState<'include' | 'exclude'>('include')
  const label = (id: string) => tags.find((t) => t.id === id)?.name ?? id

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="タグ名を選ぶ"
          value={pick}
          onChange={(e) => {
            const id = e.target.value
            if (!id) return
            if (mode === 'include') {
              if (!include.includes(id)) onChange([...include, id], exclude)
            } else if (!exclude.includes(id)) {
              onChange(include, [...exclude, id])
            }
            setPick('')
          }}
          className="border-hairline rounded-control bg-canvas text-ink min-w-0 flex-1 border px-3 py-2 text-sm"
        >
          <option value="">タグ名を選ぶ</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as 'include' | 'exclude')}
          aria-label="タグの含め方"
          className="border-hairline rounded-control bg-canvas text-ink border px-3 py-2 text-sm"
        >
          <option value="include">付いている</option>
          <option value="exclude">付いていない</option>
        </select>
        {/* 設計の「タグフォルダで指定」。フォルダからタグを引く口が無い。 */}
        <button
          type="button"
          disabled
          title="タグフォルダからまとめて指定する口がまだありません"
          className="text-ink-faint text-xs opacity-50"
        >
          タグフォルダで指定
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {include.map((id) => (
          <span
            key={id}
            className="bg-accent-soft text-accent rounded-pill inline-flex items-center gap-1.5 px-2.5 py-1 text-xs"
          >
            {label(id)}
            <button
              type="button"
              onClick={() => onChange(include.filter((v) => v !== id), exclude)}
              aria-label={`${label(id)} を外す`}
            >
              ✕
            </button>
          </span>
        ))}
        {exclude.map((id) => (
          <span
            key={id}
            className="bg-warning-bg text-warning rounded-pill inline-flex items-center gap-1.5 px-2.5 py-1 text-xs"
          >
            {label(id)} 以外
            <button
              type="button"
              onClick={() => onChange(include, exclude.filter((v) => v !== id))}
              aria-label={`${label(id)} 以外 を外す`}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}

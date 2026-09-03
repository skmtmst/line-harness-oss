'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tag } from '@line-crm/shared'
import { api, type FriendListParams } from '@/lib/api'
import { friendParamsToSavedConditions } from './saved-search-utils'
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
type Block =
  | { kind: 'name'; keyword: string }
  | { kind: 'tag'; include: string[]; exclude: string[] }
  | { kind: 'field'; key: string; op: 'eq' | 'ne'; value: string }
  | { kind: 'status_message'; keyword: string }
  | { kind: 'created_at'; from: string; to: string }
  | { kind: 'chat_status'; value: 'unread' | 'in_progress' | 'resolved' }

const BLOCK_LABEL: Record<Block['kind'], string> = {
  name: '名前',
  tag: 'タグ',
  field: '友だち情報',
  status_message: 'ステータスメッセージ',
  created_at: '友だち登録日',
  chat_status: '対応状況',
}

/**
 * まだ組み立てられない条件。**押せない札として並べる。**
 * 理由は札に出す（同じ質問が繰り返されるのを避けるため）。
 */
const NOT_YET: Array<{ label: string; why: string }> = [
  { label: '個別メモ', why: 'メモを検索する口がありません' },
  // 下のOR節は `'対応状況'` を並べる側に書いているのに、この一覧に項目が無かった。
  // そのため **設計にあるORの軸が1つ、黙って描かれないまま**だった。
  { label: '対応状況', why: '対応状況で絞る口がありません' },
  { label: 'シナリオ', why: '購読中のシナリオで絞る口がありません' },
  { label: 'イベント予約', why: '予約から友だちを引く口がありません' },
  { label: 'カレンダー予約', why: '同上' },
  { label: 'リマインダ', why: 'この友だちのぶんを引く口がありません' },
  { label: '回答フォーム', why: '回答から友だちを引く口がありません' },
  { label: '最終反応日', why: '最終反応の日付を持っていません' },
  { label: 'その他', why: '何を入れるか決まっていません' },
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
  >
  /** 画面に「絞り込み中」を出すための、人が読める形 */
  summary: string[]
}

export default function AdvancedSearchDialog({
  open,
  accountId,
  tags,
  fieldNames,
  onClose,
  onApply,
}: {
  open: boolean
  accountId: string | null
  tags: Tag[]
  /** 友だち情報の項目名。取れないときは空でよい（自由入力にする）。 */
  fieldNames: string[]
  onClose: () => void
  onApply: (result: AdvancedSearchResult) => void
}) {
  const [blocks, setBlocks] = useState<Block[]>([
    { kind: 'name', keyword: '' },
    { kind: 'tag', include: [], exclude: [] },
    { kind: 'field', key: '', op: 'eq', value: '' },
  ])
  const [visibility, setVisibility] = useState<'' | 'following' | 'blocked'>('following')
  const [sort, setSort] = useState<'recent' | 'oldest'>('recent')
  const [count, setCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [savedNotice, setSavedNotice] = useState('')

  const params = useMemo<AdvancedSearchResult['params']>(() => {
    const p: AdvancedSearchResult['params'] = { sort }
    if (visibility) p.visibility = visibility
    for (const b of blocks) {
      if (b.kind === 'name' && b.keyword.trim()) p.search = b.keyword.trim()
      if (b.kind === 'tag') {
        if (b.include.length) p.tagIds = b.include
        if (b.exclude.length) p.excludeTagIds = b.exclude
      }
      if (b.kind === 'field' && b.key.trim() && b.value.trim()) {
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
    return p
  }, [blocks, visibility, sort])

  const summary = useMemo(() => {
    const out: string[] = []
    if (params.search) out.push(`名前に「${params.search}」`)
    if (params.tagIds?.length) {
      out.push(`タグ ${params.tagIds.map((id) => tags.find((t) => t.id === id)?.name ?? id).join('・')}`)
    }
    if (params.excludeTagIds?.length) {
      out.push(
        `タグ以外 ${params.excludeTagIds.map((id) => tags.find((t) => t.id === id)?.name ?? id).join('・')}`,
      )
    }
    for (const [k, v] of Object.entries(params.metadata ?? {})) out.push(`${k} が ${v}`)
    for (const [k, v] of Object.entries(params.metadataNot ?? {})) out.push(`${k} が ${v} 以外`)
    if (params.statusMessage) out.push(`ひとこと「${params.statusMessage}」`)
    if (params.createdFrom || params.createdTo) {
      out.push(`登録日 ${params.createdFrom || '…'} 〜 ${params.createdTo || '…'}`)
    }
    if (params.chatStatus) {
      out.push(
        `対応状況 ${{ unread: '未対応', in_progress: '対応中', on_hold: '保留', resolved: '対応済み' }[params.chatStatus]}`,
      )
    }
    if (params.visibility === 'blocked') out.push('ブロックした人')
    return out
  }, [params, tags])

  /** 該当件数。押す前に何人になるかが分からないと、条件を組み立てられない。 */
  const recount = useCallback(async () => {
    setCounting(true)
    // 件数だけ欲しいので1件だけ取る。total は絞り込み後の総数が返る。
    const res = await api.friends.list({ ...params, accountId: accountId ?? undefined, limit: 1, includeTags: false })
    setCounting(false)
    setCount(res.success ? res.data.total : null)
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
      const res = await api.savedSearches.create({
        name: saveName.trim(),
        accountId,
        conditions: friendParamsToSavedConditions(params),
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#101828]/45 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[calc(100vh-32px)] w-full max-w-[760px] flex-col overflow-hidden rounded-[16px] border border-[#DADDE2] bg-canvas shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#EAEBED] px-6 py-5">
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
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-xl leading-none text-[#8B938D] hover:bg-[#F6F6F8]"
          >
            ×
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-6 py-4">
          <section className="rounded-[12px] border border-[#A8E9C1] bg-[#E9F9EF] px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-medium text-[#079B45]">現在の条件に一致</p>
                <p className="mt-0.5 text-xl font-bold tabular-nums text-[#057A37]">
                  {counting ? '…' : count === null ? '—' : `${count.toLocaleString('ja-JP')}人`}
                </p>
              </div>
              <span className="text-[11px] text-[#079B45]">自動で再計算</span>
            </div>
          </section>

          <section className="rounded-[12px] border border-[#DADDE2] bg-canvas p-3">
          <div className="flex items-center gap-2 px-1 pb-2">
            <span className="bg-accent-deep text-on-accent rounded-pill px-2 py-0.5 text-xs font-bold">
              AND
            </span>
            <span className="text-ink text-sm font-bold">すべて満たす条件</span>
          </div>

          {blocks.map((b, i) => (
            <section key={`${b.kind}-${i}`} className="mb-2 rounded-[9px] bg-[#F6F6F8] p-3 last:mb-0">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-ink text-sm font-bold">{BLOCK_LABEL[b.kind]}</h3>
                <button
                  type="button"
                  onClick={() => drop(i)}
                  aria-label={`${BLOCK_LABEL[b.kind]}の条件を外す`}
                  className="text-danger text-xs hover:underline"
                >
                  外す
                </button>
              </div>

              {b.kind === 'name' && (
                <>
                  <input
                    value={b.keyword}
                    onChange={(e) => patch(i, { ...b, keyword: e.target.value })}
                    placeholder="キーワードを入力"
                    className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm"
                  />
                  {/* 設計は LINE登録名 / 本名 / システム表示名 を選べる。
                      いま持っているのは display_name だけ。 */}
                  <p className="text-ink-faint mt-1 text-xs">
                    LINE登録名から探します。本名とシステム表示名は、まだ検索の対象にできません。
                  </p>
                </>
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
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    list="friend-field-names"
                    value={b.key}
                    onChange={(e) => patch(i, { ...b, key: e.target.value })}
                    placeholder="友だち情報欄名を入力"
                    className="border-hairline rounded-control bg-canvas text-ink min-w-0 flex-1 border px-3 py-2 text-sm"
                  />
                  <datalist id="friend-field-names">
                    {fieldNames.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                  <select
                    value={b.op}
                    onChange={(e) => patch(i, { ...b, op: e.target.value as 'eq' | 'ne' })}
                    className="border-hairline rounded-control bg-canvas text-ink border px-3 py-2 text-sm"
                  >
                    <option value="eq">等しい</option>
                    <option value="ne">等しくない</option>
                  </select>
                  <input
                    value={b.value}
                    onChange={(e) => patch(i, { ...b, value: e.target.value })}
                    placeholder="値を入力"
                    className="border-hairline rounded-control bg-canvas text-ink min-w-0 flex-1 border px-3 py-2 text-sm"
                  />
                </div>
              )}

              {b.kind === 'status_message' && (
                <input
                  value={b.keyword}
                  onChange={(e) => patch(i, { ...b, keyword: e.target.value })}
                  placeholder="ひとことに含む文字"
                  className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm"
                />
              )}

              {b.kind === 'created_at' && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={b.from}
                    onChange={(e) => patch(i, { ...b, from: e.target.value })}
                    className="border-hairline rounded-control bg-canvas text-ink border px-3 py-2 text-sm"
                  />
                  <span className="text-ink-secondary text-sm">〜</span>
                  <input
                    type="date"
                    value={b.to}
                    onChange={(e) => patch(i, { ...b, to: e.target.value })}
                    className="border-hairline rounded-control bg-canvas text-ink border px-3 py-2 text-sm"
                  />
                </div>
              )}

              {b.kind === 'chat_status' && (
                <select
                  value={b.value}
                  onChange={(e) =>
                    patch(i, { ...b, value: e.target.value as 'unread' | 'in_progress' | 'resolved' })
                  }
                  className="border-hairline rounded-control bg-canvas text-ink border px-3 py-2 text-sm"
                >
                  <option value="unread">未対応</option>
                  <option value="in_progress">対応中</option>
                  <option value="resolved">対応済み</option>
                </select>
              )}
            </section>
          ))}

          <div className="mt-2 flex flex-wrap gap-2 px-1 pt-1">
              {(Object.keys(BLOCK_LABEL) as Block['kind'][]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => add(k)}
                  className="text-action rounded-[7px] px-1 py-1 text-xs font-semibold hover:bg-[#F3F8FF]"
                >
                  ＋ {BLOCK_LABEL[k]}
                </button>
              ))}
          </div>
          </section>

          <section className="rounded-[12px] border border-[#DADDE2] bg-canvas p-3">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[#0067D9] px-2 py-0.5 text-xs font-bold text-on-action">OR</span>
              <span className="text-sm font-bold text-[#1D1D1F]">いずれか1つ以上満たす条件</span>
            </div>
            {/*
              **押せない理由を `title` に隠さない。**

              以前は `title={item.why}` だけで、マウスを乗せた人にしか読めなかった。
              押せない札が理由なしに5つ並ぶと、壊れているのか、まだ無いのか分からない。
              `NOT_YET` は理由の文をもう持っているので、札の下に出す。
            */}
            <div className="mt-3 flex flex-wrap gap-3">
              {NOT_YET.filter((item) => ['対応状況', 'シナリオ', 'イベント予約', '回答フォーム', '最終反応日'].includes(item.label)).map((item) => (
                <div key={item.label} className="flex max-w-xs flex-col gap-1">
                  <button type="button" disabled className="w-fit rounded-full border border-[#DADDE2] bg-[#F6F8FB] px-3 py-1.5 text-xs text-[#667085] opacity-70">
                    ＋ {item.label === 'イベント予約' ? '予約' : item.label}
                  </button>
                  {/* 任意値の class を足さない。10px は `--text-nano`、色は `--color-v6-ink-faint`
                      （#8b938d）が同じ値を既に持っている。design-debt を増やさずに済む。 */}
                  <span className="text-v6-ink-faint text-nano leading-tight">{item.why}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-2 sm:grid-cols-3">
            <label className="rounded-[9px] border border-[#DADDE2] bg-canvas px-3 py-2">
              <span className="text-[10px] text-[#8B938D]">対象</span>
              <select value={visibility} onChange={(event) => setVisibility(event.target.value as '' | 'following' | 'blocked')} className="mt-0.5 w-full border-0 bg-transparent p-0 text-xs font-semibold text-[#565F59] outline-none">
                <option value="following">友だち中</option>
                <option value="blocked">ブロックした人</option>
                <option value="">すべて</option>
              </select>
            </label>
            <label className="rounded-[9px] border border-[#DADDE2] bg-canvas px-3 py-2">
              <span className="text-[10px] text-[#8B938D]">並び順</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as 'recent' | 'oldest')}
                  className="mt-0.5 w-full border-0 bg-transparent p-0 text-xs font-semibold text-[#565F59] outline-none"
                >
                  <option value="recent">友だち追加の新しい順</option>
                  <option value="oldest">友だち追加の古い順</option>
                </select>
            </label>
            <label className="rounded-[9px] border border-[#DADDE2] bg-canvas px-3 py-2">
              <span className="text-[10px] text-[#8B938D]">表示件数</span>
              <select defaultValue="20" className="mt-0.5 w-full border-0 bg-transparent p-0 text-xs font-semibold text-[#565F59] outline-none">
                {[10, 20, 30, 40, 50].map((size) => <option key={size} value={size}>{size}件</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-[#EAEBED] px-6 py-4">
          <button
            type="button"
            onClick={() => {
              setBlocks([])
              setVisibility('')
            }}
            className="text-xs font-medium text-[#8B938D] hover:text-[#565F59]"
          >
            条件をすべてクリア
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-[9px] border border-[#DADDE2] bg-canvas px-4 py-2 text-sm font-semibold text-[#565F59] hover:bg-[#F6F6F8]"
          >
            キャンセル
          </button>
          {savedNotice ? <span className="text-xs font-semibold text-v6-accent">{savedNotice}</span> : null}
          <Button type="button" onClick={() => { setSaveOpen(true); setSaveError(''); setSavedNotice('') }}>条件を保存</Button>
          <button
            type="button"
            onClick={() => onApply({ params, summary })}
            className="rounded-[9px] bg-[#07C653] px-5 py-2 text-sm font-bold text-on-accent hover:bg-[#079B45]"
          >
            {counting ? '再計算中…' : count === null ? 'この条件で表示' : `${count.toLocaleString('ja-JP')}人を表示`}
          </button>
        </div>
      </div>
      {saveOpen ? (
        <div className="fixed inset-0 z-110 flex items-center justify-center bg-[#101828]/45 p-4" onClick={() => setSaveOpen(false)}>
          <section className="w-full max-w-md rounded-v6-dialog border border-hairline bg-canvas p-5 shadow-v6-card" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-lg font-bold text-v6-ink">この条件を保存</h3>
            <p className="mt-1 text-xs leading-5 text-v6-ink-faint">保存後は「保存した検索」から何度でも呼び出せます。</p>
            <label className="mt-4 block text-sm font-semibold text-v6-ink-secondary">
              条件名
              <TextInput autoFocus value={saveName} onChange={(event) => setSaveName(event.target.value)} maxLength={80} placeholder="例：VIPかつ未契約" className="mt-2" />
            </label>
            {saveError ? <p className="mt-3 text-sm text-v6-danger">{saveError}</p> : null}
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

'use client'

import SelectField from '@/components/shared/select-field'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Trash2, TriangleAlert } from 'lucide-react'
import FolderPanel from '@/components/shared/folder-panel'
import { toDraft } from '@/components/auto-replies/edit-dialog'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import type { Folder } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import EditDialog, { type AutoReplyDraft } from '@/components/auto-replies/edit-dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Button from '@/components/shared/button'
import {
  EFFECTIVE_LEGEND,
  LOAD_STATE_WORDS,
  NO_WRITE_PERMISSION,
  UNNAMED_ACCOUNT,
  actionWord,
  effectiveAccountWord,
  isCurrentAutoReplyLoad,
  matchTypeWord,
  messageKindWord,
  metricWord,
  responseTypeWord,
  templateWord,
  visibleAutoReplyLoadState,
  type LoadState,
} from './auto-reply-words'

interface EffectiveAccount {
  accountId: string
  accountName: string
  status: 'reply' | 'silent' | 'not_applicable'
  via: 'inline' | 'automation' | null
}

interface AutoReply {
  id: string
  keyword: string
  matchType: 'exact' | 'contains'
  responseType: string
  responseContent: string
  templateId: string | null
  lineAccountId: string | null
  isActive: boolean
  activeFrom: string | null
  activeUntil: string | null
  cooldownMinutes: number | null
  skipWhenOperatorActive: boolean
  priority: number
  messageKinds: string[] | null
  /** 151: 応答したときに順に実行すること。 */
  actions: unknown[] | null
  /** 151: 応答する曜日（0=日 … 6=土）。 */
  responseWeekdays: number[] | null
  responseHolidayRule: string | null
  oncePerFriend: boolean
  keywords: unknown[] | null
  friendConditions: unknown | null
  /** 157: キーワードを問わず、届いたメッセージすべてに応答する。 */
  respondToAll: boolean
  /** 158: 管理用の名前。空なら keyword を代わりに出す。 */
  name: string | null
  /** 158: 'any'（どれか1つ）か 'all'（すべて）。 */
  keywordMatchMode: string
  /** フォルダ。分けていなければ null。 */
  folderId: string | null
  /** 152: 当たった回数（今月・累計）。 */
  hits?: { period: number; total: number }
  createdAt: string
  effectiveAccounts?: EffectiveAccount[]
}

interface PendingDelete {
  item: AutoReply
  /** 削除対象を選んだ時点のアカウント。切替後に古い対象を消さないために固定する。 */
  accountId: string | null
}

/**
 * 応答したときに行うことを、短い言葉で並べる。
 *
 * 一覧に「タグ → 共通情報」と出す。設定を開かずに何をするルールか
 * 読めるようにするため。言い換えの表は `auto-reply-words` が持つ。
 */
function actionSummary(rule: { actions: unknown[] | null }): string[] {
  if (!Array.isArray(rule.actions)) return []
  return rule.actions.flatMap((item): string[] => {
    if (!item || typeof item !== 'object') return []
    const r = item as Record<string, unknown>
    const type = r.actionType ?? r.action_type
    if (typeof type !== 'string') return []
    return [actionWord(type)]
  })
}

/** フォルダに入れていないものを選ぶための、内部だけの値。 */
const UNFILED = '__unfiled__'

type SortKey = 'hits' | 'priority' | 'name' | 'created'

/**
 * よく使う絞り込み。
 *
 * 「よく使う」は設計に語として入っているが、何をもって「よく使う」かは
 * 決まっていなかった。**数えられるもの**で定義する。数えられない言葉を
 * 画面に置くと、押しても何も起きない。
 */
const SAVED_FILTERS: { key: string; label: string; note: string }[] = [
  { key: 'used', label: 'よく使う', note: '今月1回以上当たったルール' },
  { key: 'inactive', label: '停止中のみ', note: '無効にしてあるルール' },
  { key: 'timed', label: '時間帯あり', note: '曜日か時間帯を決めているルール' },
  { key: 'never', label: '未ヒット', note: '一度も当たっていないルール' },
]

interface TemplateLite {
  id: string
  name: string
  messageType: string
  messageContent: string
}

/**
 * 設定してある条件をその場で読める形にする。
 * 条件が無いものは何も出さない。「条件なし」と書くと、条件付きの行が
 * 埋もれてしまう。
 */
function conditionChips(r: AutoReply) {
  const chips: string[] = []
  if (r.activeFrom || r.activeUntil) {
    chips.push(`${r.activeFrom ?? ''}〜${r.activeUntil ?? ''}`)
  }
  if (r.cooldownMinutes) chips.push(`${r.cooldownMinutes}分あけて`)
  if (r.skipWhenOperatorActive) chips.push('対応中は止める')
  if (r.messageKinds && r.messageKinds.length > 0) {
    chips.push(`${r.messageKinds.map(messageKindWord).join('・')}のみ`)
  }
  return chips
}

export default function AutoRepliesPage() {
  const { selectedAccountId, accounts } = useAccount()
  const [items, setItems] = useState<AutoReply[]>([])
  const [query, setQuery] = useState('')
  const [templates, setTemplates] = useState<TemplateLite[]>([])
  const [templateListAvailable, setTemplateListAvailable] = useState(true)
  /**
   * 読み込みの状態。**「まだ読んでいる」「読めなかった」「権限が無い」を
   * 混ぜない。** 混ぜると、登録したものが消えたように読める。
   */
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [folders, setFolders] = useState<Folder[]>([])
  /** 選んでいるフォルダ。空は「すべて」、UNFILED は「未分類」。 */
  const [folderFilter, setFolderFilter] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('hits')
  const [savedFilter, setSavedFilter] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [editing, setEditing] = useState<AutoReplyDraft | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId
  const loadGenerationRef = useRef(0)
  const [loadedAccountId, setLoadedAccountId] = useState<string | null | undefined>(undefined)

  const load = useCallback(async () => {
    const requestAccountId = selectedAccountId
    const requestGeneration = ++loadGenerationRef.current
    setLoadState('loading')
    try {
      const [arRes, tplRes] = await Promise.all([
        api.autoReplies.list({ accountId: selectedAccountId || undefined }),
        api.templates.list(),
      ])
      if (!isCurrentAutoReplyLoad(
        requestAccountId,
        selectedAccountIdRef.current,
        requestGeneration,
        loadGenerationRef.current,
      )) return
      // 応答が返ってきても中身が無いことがある。そのときも成功にしない。
      if (!arRes.success) {
        setLoadedAccountId(requestAccountId)
        setLoadState('error')
        return
      }
      setItems(arRes.data)
      setTemplateListAvailable(tplRes.success)
      setTemplates(tplRes.success
        ? tplRes.data.map((t) => ({
            id: t.id,
            name: t.name,
            messageType: t.messageType,
            messageContent: t.messageContent,
          }))
        : [])
      setLoadedAccountId(requestAccountId)
      setLoadState('ready')
    } catch (reason) {
      if (!isCurrentAutoReplyLoad(
        requestAccountId,
        selectedAccountIdRef.current,
        requestGeneration,
        loadGenerationRef.current,
      )) return
      // 403 は通信の失敗ではない。読み直しても直らないので、そう書く。
      setLoadedAccountId(requestAccountId)
      setLoadState(reason instanceof ApiError && reason.status === 403 ? 'forbidden' : 'error')
    }
  }, [selectedAccountId])

  const loadFolders = useCallback(async () => {
    const res = await api.folders.list('auto_reply')
    if (res.success) setFolders(res.data)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { void loadFolders() }, [loadFolders])

  const templateById = new Map(templates.map((t) => [t.id, t]))
  const accountById = new Map(accounts.map((a) => [a.id, a]))

  const renderEffectiveCell = (r: AutoReply) => {
    if (!r.effectiveAccounts || r.effectiveAccounts.length === 0) {
      // 適用アカウントを計算していない古い形の返事。名前だけで出す。
      if (!r.lineAccountId) return <span className="text-ink-faint italic">全アカウント</span>
      const acc = accountById.get(r.lineAccountId)
      const name = acc?.displayName ?? acc?.name
      // 名前が引けないときもIDの断片は出さない。何が起きているかを書く。
      if (!name) {
        return (
          <span className="text-ink-faint" title={UNNAMED_ACCOUNT.note}>
            {UNNAMED_ACCOUNT.label}
          </span>
        )
      }
      return <span className="text-ink-secondary">{name}</span>
    }
    return (
      <div className="flex flex-wrap gap-1">
        {r.effectiveAccounts.map((ea) => {
          const acc = accountById.get(ea.accountId)
          const label = acc?.displayName ?? acc?.name ?? ea.accountName ?? UNNAMED_ACCOUNT.label
          const word = effectiveAccountWord(ea.status, ea.via)
          const title = `${label}：${word.note}`
          if (ea.status === 'not_applicable') {
            return (
              <span
                key={ea.accountId}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-canvas-sunken text-ink-faint line-through"
                title={title}
              >
                {label}
              </span>
            )
          }
          if (ea.status === 'reply') {
            return (
              <span
                key={ea.accountId}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-success-bg text-green-700 font-medium"
                title={title}
              >
                {word.mark} {label}{ea.via === 'automation' && <span className="text-green-500">⚙</span>}
              </span>
            )
          }
          return (
            <span
              key={ea.accountId}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-700"
              title={title}
            >
              {word.mark} {label}
            </span>
          )
        })}
      </div>
    )
  }

  const renderResponseCell = (r: AutoReply) => {
    // 出す言葉は `auto-reply-words` が決める。ここは色だけを持つ。
    const word = responseTypeWord(r.responseType)
    return (
      <span
        className={
          r.responseType === 'silent'
            ? 'text-ink-faint text-xs'
            : r.responseType === 'flex'
              ? 'px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-[10px] font-medium'
              : r.responseType === 'image'
                ? 'px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-medium'
                : 'px-1.5 py-0.5 rounded bg-canvas-sunken text-ink-secondary text-[10px] font-medium'
        }
        title={word.note}
      >
        {word.label}
      </span>
    )
  }

  const renderTemplateCell = (r: AutoReply) => {
    const word = templateWord(
      r.templateId,
      templateById.get(r.templateId ?? '')?.name ?? null,
      templateListAvailable,
    )
    // 開く先が無いものはリンクにしない。押しても何も起きない導線を置かない。
    if (!word.linked) {
      return <span className="text-[11px] text-ink-faint" title={word.note}>{word.label}</span>
    }
    return (
      <a href="/templates" className="text-blue-600 hover:underline text-xs" title={word.note}>
        {word.label}
      </a>
    )
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    if (pendingDelete.accountId !== selectedAccountId) {
      setDeleteError('アカウントが切り替わりました。削除する自動応答を選び直してください。')
      return
    }
    const requestAccountId = pendingDelete.accountId
    const targetId = pendingDelete.item.id
    setDeleting(true)
    setDeleteError('')
    try {
      const result = await api.autoReplies.delete(targetId)
      if (!result.success) {
        setDeleteError('自動応答を削除できませんでした。状態を読み直してからお試しください。')
        return
      }
      setPendingDelete(null)
      // 削除中にアカウントが変わった場合、古いアカウントの一覧で上書きしない。
      if (selectedAccountIdRef.current === requestAccountId) await load()
    } catch (reason) {
      // 権限で断られたときは読み直しても直らない。読み直せとは書かない。
      setDeleteError(
        reason instanceof ApiError && reason.status === 403
          ? `${NO_WRITE_PERMISSION.label}。${NO_WRITE_PERMISSION.note}`
          : '自動応答を削除できませんでした。状態を読み直してからお試しください。',
      )
    } finally {
      setDeleting(false)
    }
  }

  /*
    ヒット数の合計（152）。KPI に出す。

    **1つでもヒット数を持たないルールがあると、合計は足りない。**
    `?? 0` で埋めて足すと、**実測より小さい数を実測として読ませる**ことに
    なる（「今月のヒット 12回」と出ているのに、本当は数えられていない
    ルールが混ざっている）。全部そろっているときだけ数を出す。
  */
  const hitsAllKnown = items.length > 0 && items.every((r) => r.hits !== undefined)
  const monthlyHits = hitsAllKnown
    ? items.reduce((sum, r) => sum + (r.hits?.period ?? 0), 0)
    : null
  const totalHits = hitsAllKnown
    ? items.reduce((sum, r) => sum + (r.hits?.total ?? 0), 0)
    : null
  // 曜日か時間帯を決めているルール。「営業時間外だけ返す」の類がいくつあるか。
  // これはルール自身の設定なので、ヒット数が無くても数えられる。
  const timeRestrictedCount = items.filter(
    (r) => r.activeFrom || r.activeUntil || (r.responseWeekdays?.length ?? 0) > 0,
  ).length
  /*
    **ヒット数が分からないルールを「一度も当たっていない」と数えない。**
    `?? 0` だと、数えられていないだけのルールが「未ヒット」に混ざり、
    消してよいものとして読まれる。
  */
  const neverHitCount = hitsAllKnown
    ? items.filter((r) => r.hits?.total === 0).length
    : null
  // アカウントが変わってから新しい取得が始まるまでの1描画でも、前の一覧を
  // 見せない。取得側の照合と表示側の照合を両方持つ。
  const visibleLoadState = visibleAutoReplyLoadState(
    loadState,
    loadedAccountId,
    selectedAccountId,
  )
  const ready = visibleLoadState === 'ready'

  /**
   * 選んだあとにアカウントを切り替えられたら、**確認のボタンを出さない。**
   * 押せる形で置いておくと、別のアカウントの設定を消したように読める。
   */
  const deleteTargetStale =
    pendingDelete !== null && pendingDelete.accountId !== selectedAccountId

  // キーワードと返す本文の両方を見る。名前を付けていないルールは
  // キーワードでしか探せない。
  const q = query.trim()
  const shown = q
    ? items.filter(
        (r) =>
          r.keyword.includes(q) ||
          (r.name ?? '').includes(q) ||
          (r.responseContent ?? '').includes(q),
      )
    : items
  const inFolder = shown.filter((r) => {
    if (folderFilter === UNFILED) return !r.folderId
    if (folderFilter) return r.folderId === folderFilter
    return true
  })

  const inSaved = inFolder.filter((r) => {
    if (savedFilter === 'inactive') return !r.isActive
    /*
      **ヒット数が分からないルールを、どちらの札にも入れない。**
      `?? 0` だと「未ヒット」に混ざり、当たっているかもしれないルールを
      消してよいものとして見せてしまう。
    */
    if (savedFilter === 'used') return (r.hits?.period ?? 0) > 0
    if (savedFilter === 'never') return r.hits?.total === 0
    if (savedFilter === 'timed') {
      return Boolean(r.activeFrom || r.activeUntil || (r.responseWeekdays?.length ?? 0) > 0)
    }
    return true
  })

  // 並び替えは元の配列を壊さないよう写してから。
  const sortedItems = [...inSaved].sort((a, b) => {
    switch (sortKey) {
      case 'hits':
        return (b.hits?.period ?? 0) - (a.hits?.period ?? 0)
      case 'priority':
        // 評価順は「実際に見る順」。一覧の並びと動く順を合わせる。
        return a.priority - b.priority || a.createdAt.localeCompare(b.createdAt)
      case 'name':
        return (a.name || a.keyword).localeCompare(b.name || b.keyword, 'ja')
      case 'created':
        return b.createdAt.localeCompare(a.createdAt)
    }
  })

  const shownInFolder = sortedItems.slice(0, pageSize)
  const hiddenCount = sortedItems.length - shownInFolder.length

  return (
    <div>
      <div data-design="Head">
      <Header
        title="自動応答"
        description="受信したメッセージに自動で返します。キーワード・メッセージ種別・曜日や時間帯・友だち条件で出し分けできます。"
        action={
          <div className="flex flex-wrap gap-2">
          {/*
            **押しても何も起きない「マニュアル」を出さない**（`v6-common-rules`
            §5-5「動くまで描かない」／S0 の #719 が一覧の帯で同じことをした）。
            行き先が決まっていないので、押せない形で位置だけ見せても、
            いつ使えるようになるのか読む人には分からない。
            「並び替え」は評価順で自動に決まるため、押す口そのものが要らない。
          */}
          <button
            onClick={() => setFolderDialogOpen(true)}
            className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-4 py-2 text-sm font-medium transition-colors"
          >
            フォルダを追加
          </button>
          <button
            onClick={() => setEditing({
              keyword: '',
              matchType: 'exact',
              responseType: 'text',
              responseContent: '',
              templateId: null,
              lineAccountId: selectedAccountId,
              isActive: true,
            })}
            className="bg-accent-deep text-on-accent transition-colors hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium"
          >
            自動応答を作成
          </button>
          </div>
        }
      />
      </div>

      <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">ルール</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {metricWord(visibleLoadState, items.length)}
            {ready && <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            {ready
              ? `停止中 ${items.filter((r) => !r.isActive).length}件`
              : LOAD_STATE_WORDS[visibleLoadState].label}
          </p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">今月のヒット</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {metricWord(visibleLoadState, monthlyHits)}
            {ready && <span className="text-ink-faint ml-0.5 text-xs font-normal">回</span>}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            {ready
              ? `累計 ${totalHits ?? '—'}回・ヒット数はルールごとに数えます`
              : LOAD_STATE_WORDS[visibleLoadState].label}
          </p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">営業時間外の応答</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {metricWord(visibleLoadState, timeRestrictedCount)}
            {ready && <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            {ready ? '曜日か時間帯を決めているルール' : LOAD_STATE_WORDS[visibleLoadState].label}
          </p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">未ヒット</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {metricWord(visibleLoadState, neverHitCount)}
            {ready && <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            {ready
              ? '一度も当たっていないルール'
              : LOAD_STATE_WORDS[visibleLoadState].label}
          </p>
        </div>
      </div>

      {/* 複数当てはまったときの挙動。書いていないと必ず問い合わせになる。 */}
      <div className="bg-info-bg text-info mb-4 rounded-lg p-3 text-xs leading-relaxed">
        上にあるルールから順に見て、<strong>最初に当てはまった1つだけ</strong>が動きます。
        時間帯や連投の設定で見送られたときは、その次のルールを見ます。
        並び順は「評価順」の数字で決まり、小さいほど先に見ます。
      </div>

      {/* 「適用アカウント」欄の札の読み方。札の見た目と1対1で並べる。 */}
      <div className="bg-info-bg border-hairline text-info mb-4 space-y-1 rounded-lg border p-3 text-xs">
        {EFFECTIVE_LEGEND.map((row) => (
          <p key={row.status}>
            <span
              className={
                row.status === 'reply'
                  ? 'inline-flex items-center px-1.5 py-0.5 rounded bg-success-bg text-green-700'
                  : row.status === 'silent'
                    ? 'inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 text-amber-700'
                    : 'inline-flex items-center px-1.5 py-0.5 rounded bg-canvas-sunken text-ink-faint line-through'
              }
            >
              {row.mark ? `${row.mark} ` : ''}アカウント名
            </span>{' '}
            {row.text}
          </p>
        ))}
      </div>

      <div
        data-design="Bar"
        className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3"
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="自動応答名で検索"
          aria-label="自動応答名で検索"
          className="border-hairline rounded-control focus:ring-accent min-w-0 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
        />
        <span className="text-ink-faint text-xs whitespace-nowrap">並び順</span>
        <SelectField value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="並び順" options={[{ value: "hits", label: "ヒット数が多い順" }, { value: "priority", label: "評価順" }, { value: "name", label: "名前順" }, { value: "created", label: "作った順" }]} className="border-hairline rounded-control focus:ring-accent border px-2 py-2 text-sm focus:ring-2 focus:outline-none" />
        <span className="text-ink-faint text-xs whitespace-nowrap">表示</span>
        <SelectField
          size="compact"
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          aria-label="表示件数"
          options={[{ value: '20', label: '20件' }, { value: '50', label: '50件' }, { value: '100', label: '100件' }]}
        />
      </div>

      <div data-design="Saved" className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-ink-faint text-xs whitespace-nowrap">保存した条件</span>
        {SAVED_FILTERS.map((f) => {
          const on = savedFilter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setSavedFilter(on ? '' : f.key)}
              aria-pressed={on}
              title={f.note}
              className={`rounded-pill border px-3 py-1 text-xs transition-colors ${
                on
                  ? 'border-accent bg-accent-soft text-ink'
                  : 'border-hairline text-ink-secondary hover:bg-canvas-sunken'
              }`}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {folderDialogOpen && (
        <FolderAddDialog
          kind="auto_reply"
          note="自動応答を分けてしまう箱です。消しても、入っていた応答は未分類として残ります。"
          placeholder="例: 01_営業時間外"
          onClose={() => setFolderDialogOpen(false)}
          onAdded={() => void loadFolders()}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <FolderPanel
          total={ready ? `${items.length} 件` : '—'}
          activeId={folderFilter}
          onSelect={setFolderFilter}
          rows={[
            { id: '', label: 'すべて', count: items.length },
            ...folders.map((f) => ({
              id: f.id,
              label: f.name,
              count: items.filter((r) => r.folderId === f.id).length,
              color: f.color,
            })),
            {
              id: UNFILED,
              label: '未分類',
              count: items.filter((r) => !r.folderId).length,
            },
          ]}
        >
          <p className="text-ink-faint text-xs leading-relaxed">
            フォルダを消しても、入っていた応答は未分類として残ります。
          </p>
        </FolderPanel>

        <div data-design="Table" className="bg-canvas rounded-card border border-hairline overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px]">
            <thead>
              <tr className="bg-canvas-sunken border-b border-hairline">
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">評価順</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">自動応答名</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">一致のしかた</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">実行するアクション</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">テンプレート</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">応答条件</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">適用アカウント</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">ヒット数</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">状態</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {/*
                読めていないときに「ありません」と言わない。消えたように読める。
                読込中・読めなかった・権限が無い・本当に0件を言い分ける。
              */}
              {!ready ? (
                <tr><td colSpan={10} className="px-4 py-8">
                  <ListState
                    kind={visibleLoadState}
                    title={LOAD_STATE_WORDS[visibleLoadState].label}
                    description={LOAD_STATE_WORDS[visibleLoadState].note}
                    action={
                      visibleLoadState === 'error'
                        ? <Button onClick={() => void load()}>再読み込み</Button>
                        : undefined
                    }
                  />
                </td></tr>
              ) : shownInFolder.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8">
                  <ListState
                    kind="empty"
                    title="自動応答は0件です"
                    description="絞り込みを外すか、「自動応答を作成」から追加してください。"
                  />
                </td></tr>
              ) : (
                shownInFolder.map((r) => (
                  <tr key={r.id} className="hover:bg-canvas-sunken">
                    <td className="px-4 py-3 text-sm text-ink-secondary tabular-nums">{r.priority}</td>
                    <td className="px-4 py-3 text-sm font-medium text-ink">
                      {/* 名前があればそれを出す。無ければキーワード。
                          一律で応答するルールはキーワードが無いので、名前を付けて
                          いないと「すべてのメッセージ」しか出ず、見分けられない。 */}
                      {r.name || (r.respondToAll ? 'すべてのメッセージ' : r.keyword)}
                      {r.name && !r.respondToAll && (
                        <span className="text-ink-faint ml-1.5 text-[11px]">{r.keyword}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-secondary">{matchTypeWord(r.matchType)}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-0.5">
                        {renderResponseCell(r)}
                        {actionSummary(r).length > 0 && (
                          <div className="text-ink-secondary flex flex-wrap items-center gap-1 text-[11px]">
                            {actionSummary(r).map((label, i) => (
                              <span key={i} className="whitespace-nowrap">
                                {i > 0 && <span className="text-ink-faint mr-1">→</span>}
                                {label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">{renderTemplateCell(r)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {conditionChips(r).map((label) => (
                          <span
                            key={label}
                            className="bg-canvas-sunken text-ink-secondary rounded-pill px-1.5 py-0.5 text-[10px] whitespace-nowrap"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">{renderEffectiveCell(r)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {/* **数えられていないものを 0 と書かない。** 0 は「当たらなかった」の意味。 */}
                      <span className="text-ink text-sm tabular-nums">{r.hits?.period ?? '—'}</span>
                      <span className="text-ink-faint text-xs">回</span>
                      <span className="text-ink-faint ml-1 text-[10px]">
                        （累計 {r.hits?.total ?? '—'}）
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${r.isActive ? 'bg-success-bg text-green-700' : 'bg-canvas-sunken text-ink-faint'}`}>
                        {r.isActive ? '有効' : '無効'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => setEditing(toDraft(r))}
                        className="px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-info-bg rounded-md"
                      >
                        編集
                      </button>
                      <button
                        aria-label={`自動応答「${r.name || (r.respondToAll ? 'すべてのメッセージ' : r.keyword)}」を削除`}
                        onClick={() => {
                          setDeleteError('')
                          setPendingDelete({ item: r, accountId: selectedAccountId })
                        }}
                        className="ml-1 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-danger-bg rounded-md"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        </div>
      </div>

      {hiddenCount > 0 && (
        <p className="text-ink-faint mt-3 text-center text-xs">
          ほかに {hiddenCount} 件あります。「表示」を増やすと出ます。
        </p>
      )}

      {editing && (
        <EditDialog
          draft={editing}
          templates={templates}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}

      <div data-design-node="Gy9OK">
        <ConfirmDialog
          open={pendingDelete !== null}
          title={`自動応答「${pendingDelete?.item.name || pendingDelete?.item.keyword || 'すべてのメッセージ'}」を削除しますか？`}
          description="新しく届くメッセージへの自動返信と、タグ付けなどの後続処理が止まります。過去の実行履歴は削除されません。この操作は元に戻せません。"
          confirmLabel="自動応答を削除"
          destructive
          busy={deleting}
          error={deleteError}
          titleIcon={<TriangleAlert size={22} />}
          confirmIcon={<Trash2 size={16} />}
          onCancel={() => {
            if (deleting) return
            setDeleteError('')
            setPendingDelete(null)
          }}
          /* 消せない状態のときは押せる形にしない。理由は本文に出す。 */
          onConfirm={deleteTargetStale ? undefined : () => void handleDelete()}
        >
          {deleteTargetStale && (
            <p className="text-danger text-sm leading-relaxed" role="alert">
              アカウントが切り替わりました。削除する自動応答を選び直してください。
            </p>
          )}
        </ConfirmDialog>
      </div>
    </div>
  )
}

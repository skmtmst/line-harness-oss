'use client'

/*
 * ★V8 統括 一括配信を作る（B-37・絵 V8.pen の BBRDb：① lmWCZ・② AL5vR・③ lLyFR・④ ZU4Ae・⑤ H9eG3n）。
 *
 * オーナー 10-08：「店の一斉配信とほぼ同じ画面にする。違いは送るアカウントを選ぶだけ」。
 * 店の一斉配信を作る画面（components/broadcasts/broadcast-form.tsx）と同じ5段・同じ部品（段の帯・選ぶカード・
 * LINE の見え方・下の帯）・同じ見た目（店の CSS をそのまま読む）で組む。統括だけの口は2つ：
 *   - ② 配信対象の上の「送るアカウント」（J5DH6o：フォルダの札で絞り、アカウントのカードにチェック）
 *   - ⑤ 最終確認の「アカウントごとの確かめ」（送る人数・今月の送信枠の残り・LINE の接続・止めているか。問題のある店は外す）
 * 読み書きは統括の一括配信の口（API-7 の hq-broadcasts）。店の口（承認・テスト送信・分散・配信後のアクション・
 * 除くタグ・詳細条件）は統括の口に無いので出さない（BEHAVIOR.md の「今の口で出せないもの」）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, ArrowRight, CheckCircle2, Eye, Send } from 'lucide-react'
import type { Folder, HqBroadcastInput, HqBroadcastPreflight, HqBroadcastRun, LineAccount } from '@line-crm/shared'
import Button from '@/components/shared/button'
import CheckCard from '@/components/shared/check-card'
import Checkbox from '@/components/shared/checkbox'
import Combobox from '@/components/shared/combobox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import DateField from '@/components/shared/date-field'
import { TimeField } from '@/components/shared/date-time-field'
import FilterChip from '@/components/shared/filter-chip'
import { FolderDot, FolderDotName } from '@/components/shared/folder-dot'
import HelpTip from '@/components/shared/help-tip'
import LinePreview, { LinePreviewMessage } from '@/components/shared/line-preview'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import { RequiredBadge } from '@/components/shared/form-controls'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import StickyBar from '@/components/shared/sticky-bar'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { notifyToast } from '@/components/shared/toast'
import { japaneseDetailOf } from '@/components/shared/api-error-message'
import BroadcastStepRail from '@/components/broadcasts/broadcast-step-rail'
import { broadcastSteps, type BroadcastStepKey } from '@/components/broadcasts/broadcast-steps'
import formStyles from '@/components/broadcasts/broadcast-form-v8.module.css'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { ApiError, api, describeSaveFailure, type BroadcastMessageAsset } from '@/lib/api'
import { assetBubbleError, bubbleLegacyMessage } from '@/lib/broadcast-template'
import { formatNumber, formatRelative } from '@/lib/format'
import { hqBroadcastsApi } from '@/lib/hq-broadcasts-api'
import { hqTemplatesApi, type HqTemplateListItem } from '@/lib/hq-templates-api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import RowMenu from './row-menu'
import { ASSET_KIND, STORE_INSERTS, type HqKind, fromApiContent, jpDateTime, preflightBadge, previewText, sendTotals, splitPreflightRows, toApiContent } from './model'
import styles from './create.module.css'

type Store = Pick<LineAccount, 'id' | 'name' | 'tags'> & { friendCount: number; folderId: string | null; folder: Folder | null }
type Audience = 'all' | 'tag'
type Method = 'new' | 'template' | 'duplicate'

const STEP_ORDER: BroadcastStepKey[] = ['basic', 'audience', 'message', 'schedule', 'confirm']
const STEP_SET = new Set<string>(STEP_ORDER)
const TITLE_MAX = 60
const BODY_MAX = 5000
/** 表に1行ずつ出すのは4店まで。残りは「ほか N店」にまとめ、「…」から全部を開く。 */
const ROWS_SHOWN = 4
/** 「すべて」の札と、フォルダに入っていないアカウントの札。 */
const ALL = '__all__'
const UNFILED = '__none__'

const KIND_TABS: Array<[HqKind, string]> = [['text', 'テキスト'], ['coupon', 'クーポン'], ['rich', 'リッチメッセージ']]
const KIND_LABEL: Record<HqKind, string> = { text: 'テキスト', coupon: 'クーポン', rich: 'リッチメッセージ' }

function errorText(caught: unknown, fallback: string): string {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return '統括全体の編集権限がある人だけが一括配信を作れます。'
    if (caught.status === 409) return japaneseDetailOf(caught) || 'ほかの人が先に操作しました。もう一度確かめてください。'
    return describeSaveFailure(caught)
  }
  // 「API error: 500」のような内部の文は出さない。
  return japaneseDetailOf(caught) || fallback
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 日付（YYYY-MM-DD）と時刻（HH:MM）を日本時間として ISO にする（店の一斉配信と同じ「日本時間」の欄）。 */
function jstIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const d = new Date(`${date}T${time}:00+09:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** 下書きの日時（ISO）を、日本時間の日付と時刻の欄に戻す。 */
function splitJst(iso: string): { date: string; time: string } | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return { date: `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, '0')}-${String(j.getUTCDate()).padStart(2, '0')}`, time: `${String(j.getUTCHours()).padStart(2, '0')}:${String(j.getUTCMinutes()).padStart(2, '0')}` }
}

/** 素材（クーポン・リッチメッセージ）の吹き出し。口の messageBubblesJson と同じ形（店側の一斉配信と同じ）。 */
function assetBubble(asset: BroadcastMessageAsset) {
  return { id: 'hq-asset-1', type: asset.kind, content: { assetId: asset.id, assetName: asset.name, ...asset.payload } }
}

export default function HqBroadcastCreate() {
  usePageTitle('一括配信を作る')
  usePageCrumbs([{ label: '一括配信', href: '/hq/broadcasts' }])
  const router = useRouter()
  const params = useSearchParams()
  const role = useStaffRole()
  const canManage = role === null || canManageRole(role)

  /* 段は ?step=（店の一斉配信と同じ名前・同じ値）。押した段はすぐ出し、URL は履歴を積まずに書き換える。 */
  const urlStep = params.get('step')
  const [step, setStep] = useState<BroadcastStepKey>(urlStep && STEP_SET.has(urlStep) ? urlStep as BroadcastStepKey : 'basic')
  /* 下書きを直すとき（?id=）。保存した下書きは URL に id を残し、読み直しても同じ下書きを開く。 */
  const [draftId, setDraftId] = useState(params.get('id') ?? '')
  const [draftState, setDraftState] = useState<'none' | 'loading' | 'ready' | 'sent' | 'error'>(params.get('id') ? 'loading' : 'none')
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const [stores, setStores] = useState<Store[] | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [loadError, setLoadError] = useState<unknown>(null)
  const [folderFilter, setFolderFilter] = useState<string>(params.get('folder') ?? ALL)
  const [accountIds, setAccountIds] = useState<string[]>([])
  /* 昔の入口（?tag=<アカウントのタグ>）と、タグで作った下書き。読んだあとはアカウントを1つずつ選んだ形に直す。 */
  const legacyTags = useRef<string[]>(params.get('tag') ? [params.get('tag')!] : [])
  const [excluded, setExcluded] = useState<string[]>([])

  const [method, setMethod] = useState<Method>('new')
  const [title, setTitle] = useState('')
  const [recent, setRecent] = useState<HqBroadcastRun[]>([])
  const [templates, setTemplates] = useState<HqTemplateListItem[] | null>(null)
  const [templateId, setTemplateId] = useState('')

  const [audience, setAudience] = useState<Audience>('all')
  const [tagName, setTagName] = useState('')
  /* 配信対象の「タグ」の候補：選んだアカウントのタグの名前（同じ名前のタグを各アカウントで探して送る）。 */
  const [tagOptions, setTagOptions] = useState<Array<{ name: string; accounts: number }> | null>(null)
  const [tagStatus, setTagStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  const [kind, setKind] = useState<HqKind>('text')
  const [body, setBody] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  /* 統括で使える共有の素材（どの店にも属さないクーポン・リッチメッセージ）。 */
  const [assets, setAssets] = useState<BroadcastMessageAsset[] | null>(null)
  const [assetId, setAssetId] = useState('')
  const [previewConfirmed, setPreviewConfirmed] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  const [when, setWhen] = useState<'now' | 'later'>('later')
  const [date, setDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return ymd(d) })
  const [time, setTime] = useState('11:00')

  const [run, setRun] = useState<HqBroadcastRun | null>(null)
  const [runKey, setRunKey] = useState('')
  const [checks, setChecks] = useState<HqBroadcastPreflight[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [error, setError] = useState('')
  const [errorStep, setErrorStep] = useState<BroadcastStepKey | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [leaving, setLeaving] = useState(false)
  /* 下書きの依頼番号。作ったとき（または読んだ下書き）のものを、直すときもそのまま使う（口の決まり）。 */
  const requestRef = useRef('')

  useEffect(() => {
    let current = true
    void Promise.all([
      api.lineAccounts.list(),
      api.lineAccountFolders.list().catch(() => null),
      hqBroadcastsApi.list().catch(() => null),
    ])
      .then(([accounts, folderList, runs]) => {
        if (!current) return
        if (!accounts.success) throw new Error(accounts.error)
        const list: Store[] = accounts.data
          .filter((a) => !a.archivedAt)
          .map((a) => ({ id: a.id, name: a.name, tags: a.tags ?? [], friendCount: a.stats?.friendCount ?? 0, folderId: a.folderId ?? null, folder: a.folder ?? null }))
        setStores(list)
        if (folderList?.success) setFolders(folderList.data.folders)
        if (runs) setRecent(runs.data.filter((r) => r.status !== 'prepared').slice(0, 2))
        if (legacyTags.current.length > 0) {
          const ids = list.filter((s) => s.tags?.some((t) => legacyTags.current.includes(t.id))).map((s) => s.id)
          setAccountIds((prev) => [...new Set([...prev, ...ids])])
          legacyTags.current = []
        }
      })
      .catch((caught) => { if (current) setLoadError(caught) })
    return () => { current = false }
  }, [])

  /* 下書きを読む（?id=）。本文・送るアカウント・対象・時刻を戻し、確かめるときは同じ下書きを直す。 */
  useEffect(() => {
    const id = params.get('id')
    if (!id) return
    let current = true
    void hqBroadcastsApi.get(id)
      .then((res) => {
        if (!current) return
        const draft = res.data
        if (draft.status !== 'prepared') { setDraftState('sent'); return }
        const saved = draft.input
        setTitle(saved.title ?? '')
        setAccountIds(saved.accountIds)
        if (saved.accountTagIds.length > 0) legacyTags.current = saved.accountTagIds
        setExcluded(saved.excludedAccountIds)
        if (saved.audience?.kind === 'tag') { setAudience('tag'); setTagName(saved.audience.tagName) } else setAudience('all')
        let bubbles: Array<{ type?: string; content?: { assetId?: string } }> = []
        try { bubbles = saved.messageBubblesJson ? JSON.parse(saved.messageBubblesJson) : [] } catch { bubbles = [] }
        const asset = bubbles.find((b) => b.type === 'coupon' || b.type === 'rich_message')
        if (asset) { setKind(asset.type === 'coupon' ? 'coupon' : 'rich'); setAssetId(String(asset.content?.assetId ?? '')) }
        else { setKind('text'); setBody(fromApiContent(saved.messageContent)) }
        const at = saved.scheduledAt ? splitJst(saved.scheduledAt) : null
        if (at) { setWhen('later'); setDate(at.date); setTime(at.time) } else setWhen('now')
        requestRef.current = saved.requestId
        setRun(draft)
        setDraftState('ready')
      })
      .catch(() => { if (current) setDraftState('error') })
    return () => { current = false }
  }, [params])

  /* タグで読んだ下書きは、店の一覧が届いてからアカウントへ直す。 */
  useEffect(() => {
    if (!stores || legacyTags.current.length === 0) return
    const ids = stores.filter((s) => s.tags?.some((t) => legacyTags.current.includes(t.id))).map((s) => s.id)
    setAccountIds((prev) => [...new Set([...prev, ...ids])])
    legacyTags.current = []
  }, [stores, draftState])

  useEffect(() => {
    if (kind === 'text' || assets) return
    let current = true
    void api.broadcastMessageAssets.list()
      .then((res) => { if (current) setAssets(res.success ? res.data.filter((a) => a.lineAccountId === null && (a.kind === 'coupon' || a.kind === 'rich_message')) : []) })
      .catch(() => { if (current) setAssets([]) })
    return () => { current = false }
  }, [kind, assets])

  const chosen = useMemo(() => (stores ?? []).filter((s) => accountIds.includes(s.id)), [stores, accountIds])

  /* 配信対象の「タグ」：選んだアカウントごとにタグを読み、同じ名前でまとめる。 */
  const loadTags = useCallback(async () => {
    if (chosen.length === 0) { setTagOptions([]); setTagStatus('ready'); return }
    setTagStatus('loading')
    try {
      const lists = await Promise.all(chosen.map((s) => api.tags.list({ accountId: s.id })))
      const count = new Map<string, number>()
      for (const res of lists) {
        if (!res.success) throw new Error('tags')
        for (const name of new Set(res.data.map((t) => t.name))) count.set(name, (count.get(name) ?? 0) + 1)
      }
      setTagOptions([...count].map(([name, accounts]) => ({ name, accounts })).sort((a, b) => b.accounts - a.accounts || a.name.localeCompare(b.name, 'ja')))
      setTagStatus('ready')
    } catch {
      setTagStatus('error')
    }
  }, [chosen])
  const tagKey = chosen.map((s) => s.id).join(',')
  useEffect(() => {
    if (audience !== 'tag') return
    void loadTags()
    // 選んだアカウントが変わったときだけ読み直す。
  }, [audience, tagKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const changeStep = (next: BroadcastStepKey) => {
    setStep(next)
    const q = new URLSearchParams(params.toString())
    if (next === 'basic') q.delete('step'); else q.set('step', next)
    if (draftId) q.set('id', draftId)
    router.replace(`/hq/broadcasts/new${q.size ? `?${q.toString()}` : ''}`, { scroll: false })
    if (next === 'confirm' && (!checks || stale)) void check()
  }

  const scheduledAt = when === 'now' ? null : jstIso(date, time)
  const kindAssets = (assets ?? []).filter((a) => kind !== 'text' && a.kind === ASSET_KIND[kind])
  const asset = kind === 'text' ? null : kindAssets.find((a) => a.id === assetId) ?? null
  const bubble = asset ? assetBubble(asset) : null
  const legacy = bubble ? bubbleLegacyMessage(bubble as never) : null
  const input: Omit<HqBroadcastInput, 'requestId'> = {
    title: title.trim(),
    /* 素材は LINE へ渡せる種類（flex・imagemap など）に直して送る。口はどれも受ける。 */
    messageType: kind === 'text' ? 'text' : ((legacy?.messageType ?? 'flex') as HqBroadcastInput['messageType']),
    messageContent: kind === 'text' ? toApiContent(body) : (legacy?.messageContent ?? ''),
    ...(bubble ? { messageBubblesJson: JSON.stringify([bubble]) } : {}),
    accountIds: chosen.map((s) => s.id),
    accountTagIds: [],
    excludedAccountIds: excluded.filter((id) => accountIds.includes(id)),
    audience: audience === 'tag' && tagName ? { kind: 'tag', tagName } : { kind: 'all' },
    scheduledAt,
  }
  const key = JSON.stringify(input)
  const stale = !!run && !!checks && runKey !== key

  /** 入れていない所と、その欄のある段（店の一斉配信の「保存を押した段で理由を示す」と同じ）。 */
  const problem = (): { message: string; step: BroadcastStepKey } | null => {
    if (!title.trim()) return { message: '配信名を入れてください', step: 'basic' }
    if (title.trim().length > TITLE_MAX) return { message: `配信名は${TITLE_MAX}文字までです`, step: 'basic' }
    if (chosen.length === 0) return { message: '送るアカウントを選んでください', step: 'audience' }
    if (audience === 'tag' && !tagName) return { message: '送る相手のタグを選んでください', step: 'audience' }
    if (kind === 'text' && !body.trim()) return { message: '本文を入れてください', step: 'message' }
    if (kind !== 'text') {
      if (!asset) return { message: `${KIND_LABEL[kind]}を選んでください`, step: 'message' }
      const why = assetBubbleError(bubble as never)
      if (why) return { message: why, step: 'message' }
    }
    if (when === 'later' && !scheduledAt) return { message: '送る日時を選んでください', step: 'schedule' }
    if (scheduledAt && Date.parse(scheduledAt) <= Date.now()) return { message: '予約日時は今より後にしてください', step: 'schedule' }
    return null
  }

  /** 作る（下書きを固定）→ 確かめる → 問題のある店を外す。中身が変わったら同じ下書きを直す（版つき・依頼番号はそのまま）。 */
  const check = async (): Promise<{ run: HqBroadcastRun; checks: HqBroadcastPreflight[] } | null> => {
    const why = problem()
    if (why) { setError(why.message); setErrorStep(why.step); return null }
    setChecking(true); setError(''); setErrorStep(null)
    try {
      let current = run
      if (!current || runKey !== key) {
        const requestId = current?.input?.requestId || requestRef.current
        if (current && current.status === 'prepared' && requestId) {
          current = (await hqBroadcastsApi.update(current.id, { ...input, requestId, expectedVersion: current.version })).data
        } else {
          requestRef.current = crypto.randomUUID()
          current = (await hqBroadcastsApi.create({ ...input, requestId: requestRef.current })).data
        }
      }
      let list = (await hqBroadcastsApi.preflight(current.id)).data
      const blocked = list.filter((p) => p.blockedReasons.length > 0 && !p.excluded).map((p) => p.accountId)
      if (blocked.length > 0) {
        const ids = [...new Set([...list.filter((p) => p.excluded).map((p) => p.accountId), ...blocked])]
        current = (await hqBroadcastsApi.exclude(current.id, ids, current.version)).data
        list = list.map((p) => (ids.includes(p.accountId) ? { ...p, excluded: true } : p))
      }
      setRun(current); setRunKey(key); setChecks(list); setSavedAt(new Date().toISOString())
      if (current.id !== draftId) {
        setDraftId(current.id)
        const q = new URLSearchParams(params.toString())
        q.set('id', current.id)
        if (step !== 'basic') q.set('step', step)
        router.replace(`/hq/broadcasts/new?${q.toString()}`, { scroll: false })
      }
      return { run: current, checks: list }
    } catch (caught) {
      setError(errorText(caught, '送る前の確かめができませんでした。もう一度お試しください。'))
      return null
    } finally {
      setChecking(false)
    }
  }

  /** 表の「…」：この店を外す／この店に送る（問題の無い店だけ戻せる）。 */
  const toggleExclude = async (p: HqBroadcastPreflight) => {
    if (!run || !checks) return
    const ids = checks.filter((c) => (c.accountId === p.accountId ? !p.excluded : c.excluded)).map((c) => c.accountId)
    try {
      const next = (await hqBroadcastsApi.exclude(run.id, ids, run.version)).data
      setRun(next)
      setChecks(checks.map((c) => ({ ...c, excluded: ids.includes(c.accountId) })))
      setExcluded(ids)
      setRunKey(JSON.stringify({ ...input, excludedAccountIds: ids.filter((id) => accountIds.includes(id)) }))
    } catch (caught) {
      setError(errorText(caught, 'アカウントを外せませんでした。もう一度お試しください。'))
    }
  }

  const saveDraft = async () => {
    const result = await check()
    if (result) notifyToast('下書きに保存しました')
  }

  const askSend = async () => {
    const result = !run || stale || !checks ? await check() : { run, checks }
    if (!result) return
    if (sendTotals(result.checks).sendStores === 0) { setError('送れるアカウントがありません。外したアカウントの問題を直すか、送るアカウントを変えてください。'); return }
    setConfirmOpen(true)
  }

  const send = async () => {
    if (!run) return
    setSending(true)
    try {
      await hqBroadcastsApi.send(run.id, run.version)
      setConfirmOpen(false)
      notifyToast(when === 'now' ? '一括配信を送り始めました' : '一括配信を予約しました')
      setLeaving(true)
      router.push(`/hq/broadcasts/detail?id=${encodeURIComponent(run.id)}`)
    } catch (caught) {
      setConfirmOpen(false)
      setError(errorText(caught, '送れませんでした。もう一度確かめてください。'))
      setRunKey('')
    } finally {
      setSending(false)
    }
  }

  /** ① 配信方法「テンプレートを選択」：統括のメッセージのひな形（テキスト）を本文に読み込む。 */
  const applyTemplate = async (id: string) => {
    setTemplateId(id)
    if (!id) return
    try {
      const detail = await hqTemplatesApi.get(id)
      if (detail.template.template_type !== 'template') return
      const definition = detail.definition as { template: { messageType: string; messageContent: string; name: string } }
      if (definition.template.messageType !== 'text') { setError('文章のひな形だけ本文に読み込めます。'); setErrorStep('basic'); return }
      setKind('text')
      setBody(fromApiContent(definition.template.messageContent).slice(0, BODY_MAX))
      if (!title.trim()) setTitle(definition.template.name.slice(0, TITLE_MAX))
      setError(''); setErrorStep(null)
    } catch (caught) {
      setError(errorText(caught, 'ひな形を読み込めませんでした。もう一度お試しください。')); setErrorStep('basic')
    }
  }
  useEffect(() => {
    if (method !== 'template' || templates) return
    let current = true
    void hqTemplatesApi.listByKind('message').then((list) => { if (current) setTemplates(list) }).catch(() => { if (current) setTemplates([]) })
    return () => { current = false }
  }, [method, templates])

  /** ① 最近の配信・「過去の配信を複製」：配信名・中身・送るアカウント・対象を写す（時刻と下書きは写さない）。 */
  const duplicate = (source: HqBroadcastRun) => {
    const saved = source.input
    setMethod('duplicate')
    setTitle(`${saved.title}（複製）`.slice(0, TITLE_MAX))
    setAccountIds(saved.accountIds)
    if (saved.accountTagIds.length > 0) legacyTags.current = saved.accountTagIds
    setExcluded([])
    if (saved.audience?.kind === 'tag') { setAudience('tag'); setTagName(saved.audience.tagName) } else setAudience('all')
    let bubbles: Array<{ type?: string; content?: { assetId?: string } }> = []
    try { bubbles = saved.messageBubblesJson ? JSON.parse(saved.messageBubblesJson) : [] } catch { bubbles = [] }
    const found = bubbles.find((b) => b.type === 'coupon' || b.type === 'rich_message')
    if (found) { setKind(found.type === 'coupon' ? 'coupon' : 'rich'); setAssetId(String(found.content?.assetId ?? '')) }
    else { setKind('text'); setBody(fromApiContent(saved.messageContent)) }
    if (stores && legacyTags.current.length > 0) {
      const ids = stores.filter((s) => s.tags?.some((t) => legacyTags.current.includes(t.id))).map((s) => s.id)
      setAccountIds((prev) => [...new Set([...prev, ...ids])])
      legacyTags.current = []
    }
    notifyToast(`「${saved.title}」を写しました`)
  }

  const insert = (label: string) => {
    const el = bodyRef.current
    const at = el ? el.selectionStart : body.length
    setBody((text) => `${text.slice(0, at)}${label}${text.slice(at)}`.slice(0, BODY_MAX))
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + label.length, at + label.length) })
  }

  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({
    dirty: !leaving && (body.trim().length > 0 || title.trim().length > 0 || accountIds.length > 0),
    busy: checking || sending,
    samePage: (url) => url.pathname === '/hq/broadcasts/new',
  })

  const visibleStores = (stores ?? []).filter((s) => folderFilter === ALL || (folderFilter === UNFILED ? !s.folderId : s.folderId === folderFilter))
  const unfiledCount = (stores ?? []).filter((s) => !s.folderId).length
  const friendTotal = chosen.filter((s) => !excluded.includes(s.id)).reduce((sum, s) => sum + s.friendCount, 0)
  const totals = checks && !stale ? sendTotals(checks) : null
  const peopleLabel = totals ? `${formatNumber(totals.sendPeople)}人` : audience === 'all' && chosen.length > 0 ? `${formatNumber(friendTotal)}人` : '—人'
  const audienceLabel = audience === 'tag' ? (tagName ? `タグ：${tagName}` : 'タグ：未選択') : '友だち全員'
  const accountsLabel = chosen.length === 0 ? '未選択' : chosen.length <= 2 ? chosen.map((s) => s.name).join('・') : `${chosen[0].name} ほか ${chosen.length - 1}アカウント`
  const sendWhenLabel = when === 'now' ? '今すぐ' : scheduledAt ? jpDateTime(scheduledAt) : '未設定'
  const { shown, rest } = splitPreflightRows(checks ?? [], showAll ? Infinity : ROWS_SHOWN)
  const exampleStore = (checks ?? []).find((p) => !p.excluded && !p.blockedReasons.length)?.accountName ?? chosen[0]?.name ?? '店の名前'
  const previewBody = kind === 'text' ? previewText(body, exampleStore) : asset ? `［${KIND_LABEL[kind]}］${asset.name}` : ''
  const steps = broadcastSteps({
    basicDone: Boolean(title.trim()) && title.trim().length <= TITLE_MAX,
    audienceDone: chosen.length > 0 && (audience === 'all' || Boolean(tagName)),
    messageDone: kind === 'text' ? Boolean(body.trim()) : Boolean(asset),
    scheduleDone: when === 'now' || Boolean(scheduledAt),
  })
  const stepIndex = STEP_ORDER.indexOf(step)
  const draftLabel = savedAt ? `下書き保存済み・${formatRelative(savedAt)}` : draftState === 'ready' ? '保存済みの下書きを開いています' : '下書き・未保存'

  if (!canManage) {
    return (
      <div className={formStyles.root}>
        <header className={formStyles.header}>
          <div className={formStyles.heading}>
            <Button variant="secondary" className={formStyles.textButton} size="compact" href="/hq/broadcasts">← 一括配信一覧</Button>
            <h2>一括配信を作る</h2>
          </div>
        </header>
        <div className={formStyles.input}>
          <Notice tone="info">一括配信を作れるのは、統括全体の編集権限がある人（オーナー・管理者）だけです。</Notice>
        </div>
      </div>
    )
  }

  const shows = (key: BroadcastStepKey) => step === key
  const nextLabel = step === 'basic' ? '対象設定へ' : step === 'audience' ? 'メッセージ設定へ' : step === 'message' ? '送信設定へ' : '配信前チェックへ'

  return (
    <>
      <div className={formStyles.root} data-step={step} data-hq-broadcast-create="">
        <header className={formStyles.header}>
          <div className={formStyles.heading}>
            <Button variant="secondary" className={formStyles.textButton} size="compact" href="/hq/broadcasts">← 一括配信一覧</Button>
            <h2>一括配信を作る</h2>
            <p aria-live="polite">{draftLabel}</p>
          </div>
          <div className={formStyles.stepRail}><BroadcastStepRail steps={steps} currentKey={step} /></div>
          <Button aria-expanded={previewOpen} aria-controls="hq-broadcast-line-preview" className={formStyles.previewToggle} onClick={() => setPreviewOpen(true)}><Eye size={14} aria-hidden /> LINEの見え方</Button>
        </header>
        {error ? (
          <Notice
            tone="danger"
            role="alert"
            action={errorStep && errorStep !== step ? (
              <Button variant="secondary" size="compact" onClick={() => changeStep(errorStep)}>{`${steps[STEP_ORDER.indexOf(errorStep)].label}へ移動`}</Button>
            ) : undefined}
          >
            {error}
          </Notice>
        ) : null}
        {draftState === 'loading' ? <Notice tone="info" role="status">下書きを読み込んでいます…</Notice> : null}
        {draftState === 'sent' ? (
          <Notice tone="warn" role="alert" action={<Button size="compact" href={`/hq/broadcasts/detail?id=${encodeURIComponent(params.get('id') ?? '')}`}>詳細を見る</Button>}>
            この一括配信はもう送った（予約した）ので直せません。新しく作るときは、送るアカウントと中身を入れてください。
          </Notice>
        ) : null}
        {draftState === 'error' ? <Notice tone="danger" role="alert">下書きを読み込めませんでした。一括配信の一覧から開き直してください。</Notice> : null}

        <div className={formStyles.body}>
          <div className={formStyles.input}>
            {/* ① 基本設定（lmWCZ） */}
            {shows('basic') ? (
              <section id="broadcast-step-basic" className={formStyles.section}>
                <h3>配信方法</h3>
                <RadioCardGroup legend="配信方法" className={formStyles.methodCards}>
                  {([
                    ['new', '新しいメッセージを作成', 'テキスト・クーポン・リッチメッセージから一から作ります。'],
                    ['template', 'テンプレートを選択', '統括のテンプレート（文章）を呼び出して手直しします。'],
                    ['duplicate', '過去の配信を複製', '送った一括配信をそのまま写して作り直します。'],
                  ] as const).map(([value, label, note]) => (
                    <RadioCard key={value} name="hq-broadcast-method" value={value} checked={method === value} title={label} note={note} onChange={(next) => setMethod(next as Method)} />
                  ))}
                </RadioCardGroup>
                {method === 'template' ? (
                  <label className={formStyles.nameField}>
                    <span className={formStyles.labelRow}>読み込むテンプレート</span>
                    {templates === null ? <small>テンプレートを読み込んでいます…</small> : templates.length === 0 ? (
                      <small>統括のテンプレート（メッセージ）がまだありません。統括の「テンプレート」で作れます。</small>
                    ) : (
                      <Select aria-label="読み込むテンプレート" value={templateId} onChange={(id) => void applyTemplate(id)} size="full"
                        options={[{ value: '', label: '選んでください' }, ...templates.map((t) => ({ value: t.id, label: t.name }))]} />
                    )}
                  </label>
                ) : null}
                <label className={formStyles.nameField}>
                  <span className={formStyles.labelRow}><span className="text-ink text-sm font-bold">配信名<RequiredBadge /></span><span className="text-xs text-ink-faint">{title.trim().length} / {TITLE_MAX}文字</span></span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：8月キャンペーンのお知らせ" className={formStyles.textInput} aria-label="配信名" maxLength={TITLE_MAX * 2} />
                  <small>友だちには表示されません。一覧で見分けるための名前です</small>
                </label>
                <div className={formStyles.recentHeader}><h3>最近の配信</h3><Link href="/hq/broadcasts">一括配信の一覧を見る →</Link></div>
                <div className={formStyles.recentList}>
                  {recent.length ? recent.map((item) => {
                    const people = item.targets.reduce((sum, t) => sum + (t.excluded ? 0 : t.totalCount || 0), 0)
                    return (
                      <div key={item.id} className={formStyles.recentRow}>
                        <Send size={14} aria-hidden /><span className={formStyles.recentName} title={item.title}>{item.title}</span>
                        <span className="text-ink-faint">{jpDateTime(item.scheduledAt)} 送信 ・ {formatNumber(people)}人</span>
                        <Button size="compact" onClick={() => duplicate(item)}>複製する</Button>
                      </div>
                    )
                  }) : <p className="text-xs text-ink-faint">最近の配信はまだありません。</p>}
                </div>
              </section>
            ) : null}

            {/* ② 配信対象（AL5vR）。上に統括だけの「送るアカウント」（J5DH6o）。 */}
            {shows('audience') ? (
              <section id="broadcast-step-audience" className={formStyles.section}>
                <div className={styles.accounts} data-design-node="J5DH6o">
                  <h3>送るアカウント</h3>
                  {loadError && !stores ? <ListState kind="error" error={loadError} onRetry={() => window.location.reload()} /> : !stores ? <ListState kind="loading" /> : (
                    <>
                      <div className={styles.folderChips} role="group" aria-label="フォルダで絞る">
                        <FilterChip selected={folderFilter === ALL} onChange={() => setFolderFilter(ALL)} count={stores.length}>すべて</FilterChip>
                        {folders.map((f) => (
                          <FilterChip key={f.id} selected={folderFilter === f.id} onChange={() => setFolderFilter(folderFilter === f.id ? ALL : f.id)} icon={<FolderDot folder={f} />} count={stores.filter((s) => s.folderId === f.id).length}>{f.name}</FilterChip>
                        ))}
                        {unfiledCount > 0 && folders.length > 0 ? (
                          <FilterChip selected={folderFilter === UNFILED} onChange={() => setFolderFilter(folderFilter === UNFILED ? ALL : UNFILED)} icon={<FolderDot folder={null} />} count={unfiledCount}>未分類</FilterChip>
                        ) : null}
                      </div>
                      <div className={styles.accountCards}>
                        {visibleStores.map((s) => (
                          <CheckCard
                            key={s.id}
                            size="compact"
                            checked={accountIds.includes(s.id)}
                            onChange={(on) => setAccountIds((ids) => (on ? [...ids, s.id] : ids.filter((x) => x !== s.id)))}
                            title={<span title={s.name}><FolderDotName folder={s.folder}>{s.name}</FolderDotName></span>}
                            note={`友だち ${formatNumber(s.friendCount)} 人`}
                          />
                        ))}
                        {visibleStores.length === 0 ? <p className="text-xs text-ink-faint">このフォルダにアカウントはありません。</p> : null}
                      </div>
                      <p className={styles.accountsNote} aria-live="polite">
                        {chosen.length === 0
                          ? 'アカウントを選んでください。送る相手は、下の条件で各アカウントの友だちから選びます。'
                          : `${formatNumber(chosen.length)} アカウントを選んでいます。送る相手は、下の条件で各アカウントの友だちから選びます。`}
                      </p>
                    </>
                  )}
                </div>
                <h3>配信対象</h3>
                <RadioCardGroup legend="配信対象" className={formStyles.audienceCards}>
                  <RadioCard name="hq-broadcast-target" value="all" checked={audience === 'all'} onChange={() => setAudience('all')} title="友だち全員に配信する" note="ブロック中の人を除いた全員" />
                  <RadioCard name="hq-broadcast-target" value="tag" checked={audience === 'tag'} onChange={() => setAudience('tag')} title="タグで絞り込んで配信する" note="選んだタグが付いている人（各アカウントの同じ名前のタグ）" />
                </RadioCardGroup>
                {audience === 'tag' ? (
                  <div className="border-hairline border-t pt-4">
                    <label className="text-ink-secondary block text-xs font-semibold">含めるタグ</label>
                    <Combobox
                      aria-label="含めるタグ"
                      placeholder="タグを選んでください"
                      value={tagName}
                      onChange={setTagName}
                      options={(tagOptions ?? []).map((t) => ({ value: t.name, label: `${t.name}（${t.accounts}/${chosen.length}アカウント）` }))}
                      loading={tagStatus === 'loading'}
                      disabled={tagStatus !== 'ready' || chosen.length === 0}
                      className="mt-1 w-full sm:max-w-sm"
                    />
                    {chosen.length === 0 ? <p className="mt-1 text-xs text-ink-faint">先に送るアカウントを選ぶと、タグを選べます。</p> : null}
                    {tagStatus === 'loading' ? <p className="mt-1 text-xs text-ink-faint">タグを読み込んでいます…</p> : null}
                    {tagStatus === 'error' ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <p className="text-xs text-warning">タグを読み込めませんでした。通信を確かめて、もう一度お試しください。</p>
                        <Button variant="secondary" size="compact" onClick={() => void loadTags()}>もう一度読み込む</Button>
                      </div>
                    ) : null}
                    {tagStatus === 'ready' && chosen.length > 0 && (tagOptions ?? []).length === 0 ? <p className="mt-1 text-xs text-ink-faint">選んだアカウントにタグがありません。</p> : null}
                    {tagName && (tagOptions ?? []).some((t) => t.name === tagName && t.accounts < chosen.length) ? (
                      <p className="mt-1 text-xs text-warning">このタグが無いアカウントには送りません（最終確認で外します）。</p>
                    ) : null}
                  </div>
                ) : null}
                <div className={formStyles.exclusion}>
                  <Checkbox checked onCheckedChange={() => {}} disabled>ブロック中の人を除く</Checkbox>
                  <small>ブロック中・非表示・宛先不明の友だちには送りません</small>
                </div>
                <div className={formStyles.audienceCount} aria-live="polite"><span><Send size={14} aria-hidden /> この条件で送る人数</span><strong>{peopleLabel}</strong></div>
                {audience === 'tag' && !totals ? <p className="text-xs text-ink-faint">タグで絞った人数は、最終確認でアカウントごとに数えます</p> : null}
                <Notice tone="info"><strong>対象の確認ポイント</strong><br />人数は送る直前にもう一度数え直します。ブロック中の人には送りません</Notice>
              </section>
            ) : null}

            {/* ③ メッセージを作成（lLyFR） */}
            {shows('message') ? (
              <section id="broadcast-step-message" className={formStyles.section}>
                <h3>メッセージ（1 / 1）</h3>
                <div className={formStyles.bubbleFrame} data-embedded>
                  <div className="flex flex-wrap gap-2" role="tablist" aria-label="メッセージの形式">
                    {KIND_TABS.map(([value, label]) => (
                      <button key={value} type="button" role="tab" aria-selected={kind === value} tabIndex={kind === value ? 0 : -1} className="broadcast-message-type" data-active={kind === value || undefined}
                        onClick={() => { setKind(value); setAssetId('') }}>{label}</button>
                    ))}
                  </div>
                  {kind === 'text' ? (
                    <section>
                      <textarea
                        ref={bodyRef}
                        aria-label="本文"
                        rows={6}
                        maxLength={BODY_MAX}
                        value={body}
                        onChange={(event) => setBody(event.target.value)}
                        placeholder="{店名}より：…"
                        className="border-hairline rounded-control w-full resize-none border p-3 text-sm focus:border-accent focus:outline-none"
                      />
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className={styles.inserts}>
                          <span className="text-ink-faint">差し込む：</span>
                          {STORE_INSERTS.map((item) => (
                            <Button key={item.label} size="compact" variant="text" title={item.help} onClick={() => insert(item.label)}>{`＋ ${item.label.slice(1, -1)}`}</Button>
                          ))}
                        </span>
                        <span className="text-ink-faint">{`${formatNumber(body.length)} / ${formatNumber(BODY_MAX)}`}</span>
                      </div>
                      <p className="mt-2 text-xs text-ink-faint">{'{店名}・{店の電話番号}・{予約ページ} は、送るアカウントの名前と共通情報に置き換わります。共通情報が無いアカウントは最終確認で外します。'}</p>
                    </section>
                  ) : (
                    <section>
                      {assets === null ? <p className="text-xs text-ink-faint">読み込んでいます…</p> : kindAssets.length === 0 ? (
                        <p className="text-xs text-ink-faint">{`統括で使える${KIND_LABEL[kind]}がありません。「コンテンツ ＞ テンプレート」で、どの店にも属さない素材として作ってください。`}</p>
                      ) : (
                        <Select
                          aria-label={`${KIND_LABEL[kind]}を選ぶ`}
                          value={assetId}
                          onChange={setAssetId}
                          size="full"
                          options={[{ value: '', label: '選んでください' }, ...kindAssets.map((a) => ({ value: a.id, label: a.name }))]}
                        />
                      )}
                      {asset && assetBubbleError(bubble as never) ? <p className="mt-2 text-xs text-warning" role="alert">{assetBubbleError(bubble as never)}</p> : null}
                    </section>
                  )}
                </div>
                <div className={styles.previewCheck}>
                  <Checkbox checked={previewConfirmed} onCheckedChange={setPreviewConfirmed}>{previewConfirmed ? 'LINEプレビュー確認済み' : 'LINEプレビューが未確認です'}</Checkbox>
                  {!previewConfirmed ? <small>右の「配信イメージを見る」で確かめてください</small> : null}
                </div>
              </section>
            ) : null}

            {/* ④ 送信設定（ZU4Ae） */}
            {shows('schedule') ? (
              <section id="broadcast-step-schedule" className={formStyles.section}>
                <h3>配信日</h3>
                <RadioCardGroup legend="配信日" className={formStyles.methodCards}>
                  <RadioCard name="hq-broadcast-send-mode" value="now" checked={when === 'now'} onChange={() => setWhen('now')} title="今すぐ配信" note="⑤の確認で「今すぐ送る」を押すと、確認の小窓のあとすぐに送ります" />
                  <RadioCard name="hq-broadcast-send-mode" value="later" checked={when === 'later'} onChange={() => setWhen('later')} title="日時を指定して予約" note="決めた日時に、全アカウント同じ時刻で送ります" />
                </RadioCardGroup>
                {when === 'later' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="hq-bc-date" className="text-ink-secondary mb-1 block text-xs font-medium">送る日</label>
                      <DateField id="hq-bc-date" value={date} onChange={setDate} aria-label="送る日" />
                    </div>
                    <div>
                      <label htmlFor="hq-bc-time" className="text-ink-secondary mb-1 block text-xs font-medium">時刻（日本時間）</label>
                      <TimeField id="hq-bc-time" value={time} onChange={setTime} aria-label="時刻（日本時間）" />
                    </div>
                  </div>
                ) : null}
                <div className={formStyles.quota}>
                  <div className={formStyles.quotaHead}><strong>送信枠</strong><HelpTip label="送信枠の説明">LINE公式アカウントの月間送信枠です。アカウントごとに数えます</HelpTip><span>{totals ? `送る ${formatNumber(totals.sendPeople)}通` : 'アカウントごと'}</span></div>
                  <p>今月の残りは最終確認でアカウントごとに確かめます。足りないアカウントは外して送ります</p>
                </div>
              </section>
            ) : null}

            {/* ⑤ 最終確認（H9eG3n）＋統括だけのアカウントごとの確かめ */}
            {shows('confirm') ? (
              <div id="broadcast-step-confirm" className={formStyles.section}>
                <h3>配信前チェック</h3>
                <div className={formStyles.checkList}>
                  {([
                    { key: 'basic', label: '配信名', value: title.trim() || '配信名を入力してください', done: steps[0].state === 'done' || Boolean(title.trim()), move: '基本設定へ戻る' },
                    { key: 'audience', label: '送るアカウント・配信対象', value: `${accountsLabel} ・ ${audienceLabel} ・ ${peopleLabel}（ブロック中の人を除く）`, done: chosen.length > 0 && (audience === 'all' || Boolean(tagName)), move: '対象者へ戻る' },
                    { key: 'message', label: 'メッセージ', value: `${KIND_LABEL[kind]} ・ ${previewConfirmed ? 'LINEプレビュー確認済み' : 'LINEプレビューが未確認です'}`, done: (kind === 'text' ? Boolean(body.trim()) : Boolean(asset)) && previewConfirmed, move: 'メッセージへ戻る' },
                    { key: 'schedule', label: '送信設定', value: sendWhenLabel, done: when === 'now' || Boolean(scheduledAt), move: '送信設定へ戻る' },
                  ] as const).map((row) => (
                    <div className={formStyles.checkRow} key={row.key}>
                      {row.done ? <CheckCircle2 size={18} className="text-success" aria-hidden /> : <AlertTriangle size={18} className="text-warning" aria-hidden />}
                      <div><strong>{row.label}</strong><p>{row.value}</p></div>
                      <Button variant="secondary" className={formStyles.textButton} size="compact" onClick={() => changeStep(row.key)}>{row.move}</Button>
                    </div>
                  ))}
                </div>
                {(() => {
                  const left = [title.trim(), chosen.length > 0 && (audience === 'all' || tagName), previewConfirmed, when === 'now' || scheduledAt].filter((ok) => !ok).length
                  return (
                    <Notice tone={left ? 'warn' : 'info'}>
                      {left ? `${left}件の確認が残っています` : '配信する内容を確認してください'}
                    </Notice>
                  )
                })()}
                <h3>アカウントごとの確かめ</h3>
                {!checks || stale ? (
                  <div className={styles.checkEmpty}>
                    <span className="text-xs text-ink-faint">{stale ? '中身・送るアカウント・時刻を変えました。もう一度確かめてください。' : '送る人数・今月の送信枠の残り・LINE の接続・配信を止めていないかを、アカウントごとに確かめます。'}</span>
                    <Button onClick={() => void check()} busy={checking} busyLabel="確かめています…">送る前に確かめる</Button>
                  </div>
                ) : (
                  <>
                    <DataTable className={styles.table} data-design="hq-broadcast-preflight">
                      <thead>
                        <TableHeadRow className={styles.headRow}>
                          <Th className={styles.colStore}>アカウント</Th>
                          <Th className={styles.colPeople}>送る人数</Th>
                          <Th className={styles.colQuota}>今月の送信枠の残り</Th>
                          <Th className={styles.colCheck}>確かめ</Th>
                          <Th className={styles.colSend}>送るか</Th>
                          <Th className={styles.colMenu}><span className="sr-only">操作</span></Th>
                        </TableHeadRow>
                      </thead>
                      <tbody>
                        {shown.map((p) => {
                          const badge = preflightBadge(p, body)
                          const go = !p.excluded && p.blockedReasons.length === 0
                          return (
                            <Tr key={p.accountId} className={styles.row}>
                              <Td className={styles.colStore}><span className={styles.store} title={p.accountName}>{p.accountName}</span></Td>
                              <Td className={styles.colPeople}><span className={styles.num}>{p.audienceCount === null ? '—' : `${formatNumber(p.audienceCount)}人`}</span></Td>
                              <Td className={styles.colQuota}><span className={styles.sub}>{p.remaining === null ? '—' : `${formatNumber(p.remaining)}通`}</span></Td>
                              <Td className={styles.colCheck}><StatusBadge tone={badge.tone} title={p.blockedReasons.join('・') || undefined}>{badge.label}</StatusBadge></Td>
                              <Td className={styles.colSend}><StatusBadge tone={go ? 'success' : 'neutral'}>{go ? '送る' : '外す'}</StatusBadge></Td>
                              <Td className={styles.colMenu}>
                                <RowMenu
                                  subjectName={p.accountName}
                                  items={p.blockedReasons.length > 0
                                    ? [{ id: 'why', label: `外す理由：${p.blockedReasons.join('・')}`, disabled: true, disabledReason: '直すと次から送れます', onSelect: () => {} }]
                                    : [{ id: 'toggle', label: p.excluded ? 'このアカウントに送る' : 'このアカウントを外す', onSelect: () => void toggleExclude(p) }]}
                                />
                              </Td>
                            </Tr>
                          )
                        })}
                        {rest.length > 0 ? (
                          <Tr className={styles.row}>
                            <Td className={styles.colStore}><span className={styles.store}>{`ほか ${rest.length}アカウント`}</span></Td>
                            <Td className={styles.colPeople}><span className={styles.num}>{`${formatNumber(rest.reduce((sum, p) => sum + (p.audienceCount ?? 0), 0))}人`}</span></Td>
                            <Td className={styles.colQuota}><span className={styles.sub}>—</span></Td>
                            <Td className={styles.colCheck}><StatusBadge tone="success">すべて足りる</StatusBadge></Td>
                            <Td className={styles.colSend}><StatusBadge tone="success">送る</StatusBadge></Td>
                            <Td className={styles.colMenu}>
                              <RowMenu subjectName={`ほか ${rest.length}アカウント`} items={[{ id: 'all', label: '1つずつ見る', onSelect: () => setShowAll(true) }]} />
                            </Td>
                          </Tr>
                        ) : null}
                      </tbody>
                    </DataTable>
                    {totals ? (
                      <p className={styles.totals}>
                        <span className={styles.totalSend}>{`送る：${formatNumber(totals.sendStores)}アカウント・${formatNumber(totals.sendPeople)}人`}</span>
                        <span className={styles.totalSkip}>{`外す：${formatNumber(totals.skipStores)}アカウント・${formatNumber(totals.skipPeople)}人`}</span>
                      </p>
                    ) : null}
                  </>
                )}
                <p className="text-xs text-ink-faint">{when === 'later' ? '予約後も送る前までは、一括配信の詳細から止められます。' : '「今すぐ送る」で確認の小窓を開き、そこで送ると友だちに届きます。送信は取り消せません。'}</p>
              </div>
            ) : null}
          </div>

          <aside id="hq-broadcast-line-preview" className={formStyles.preview} data-open={previewOpen || undefined} aria-label="LINEの見え方">
            <div className={formStyles.phonePreview}>
              <LinePreview accountName={exampleStore} caption={when === 'now' ? '今日' : sendWhenLabel} note={`${exampleStore}の例です。差し込みはアカウントごとに変わります（{予約ページ}は省いて見せています）。`}>
                <LinePreviewMessage accountName={exampleStore} avatar={exampleStore.slice(0, 1)} time={when === 'now' ? '今' : time}>
                  {previewBody || '（本文がまだありません）'}
                </LinePreviewMessage>
              </LinePreview>
            </div>
            <p className={formStyles.previewCaption}>{'{店名} は例のアカウントの名前で見せています'}</p>
            <div className={formStyles.previewSummary}><h3>設定内容</h3><dl>{[
              ['送るアカウント', chosen.length ? `${accountsLabel}（${formatNumber(chosen.length)}）` : '未選択'],
              ['送る相手', `${audienceLabel}（${peopleLabel}）`],
              ['送る日時', sendWhenLabel],
            ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl></div>
            <div className={formStyles.previewActions}>
              <Button type="button" onClick={() => setPreviewConfirmed(true)}><Eye size={14} aria-hidden /> 配信イメージを見る</Button>
              {previewOpen ? <Button type="button" onClick={() => setPreviewOpen(false)}>閉じる</Button> : null}
            </div>
          </aside>
        </div>

        <StickyBar className={formStyles.footer} actions={(
          <>
            {step === 'confirm' ? <Button type="button" onClick={() => changeStep('schedule')}>戻って修正</Button> : null}
            <Button variant="secondary" className={formStyles.textButton} type="button" disabled={checking || sending} busy={checking && step !== 'confirm'} onClick={() => void saveDraft()}>下書きを保存する</Button>
            {step !== 'confirm' ? (
              <Button variant="primary" onClick={() => changeStep(STEP_ORDER[Math.min(stepIndex + 1, STEP_ORDER.length - 1)])}>
                {step === 'message' ? <><span>{nextLabel}</span><ArrowRight size={15} aria-hidden /></> : nextLabel}
              </Button>
            ) : (
              <Button variant="primary" busy={checking || sending} disabled={sending} onClick={() => void askSend()}>
                {when === 'later' ? 'この内容で予約する' : '今すぐ送る'}
              </Button>
            )}
          </>
        )} />
      </div>

      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        subject="一括配信の下書き"
        busy={checking || sending}
        onCancel={() => { if (!checking && !sending) cancelLeave() }}
        onConfirm={() => { confirmLeave() }}
      />

      <ConfirmDialog
        open={confirmOpen}
        title={`${formatNumber(totals?.sendStores ?? 0)}アカウントに送ります`}
        description={`${formatNumber(totals?.sendPeople ?? 0)}人に${when === 'now' ? 'すぐ' : `${sendWhenLabel} に`}送ります。送った LINE は取り消せません。${totals && totals.skipStores ? `外した${formatNumber(totals.skipStores)}アカウントには送りません。` : ''}`}
        confirmLabel={when === 'now' ? '送る' : '予約する'}
        busy={sending}
        warning
        onConfirm={() => void send()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}

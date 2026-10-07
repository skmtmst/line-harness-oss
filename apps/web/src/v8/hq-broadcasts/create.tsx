'use client'

/*
 * ★V8 統括 一括配信を作る（提案 E-9 `p17Qku`）。
 *
 * 統括の画面から、アカウントのタグ（フォルダ）か店を選び、同じ内容を一度に送る。各店に入らずに送れる。
 * ① 宛先 → ② 中身 → ③ 送る時刻 → ④ 送る前の確かめ（店ごとの人数・送信枠・接続・停止）→［N店に送る］。
 * 口は API-7 の hq-broadcasts（作る＝下書きを固定 → preflight → 外す → send）。動きは BEHAVIOR.md。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, Info, ListFilter, Plus, Send } from 'lucide-react'
import type { HqBroadcastInput, HqBroadcastPreflight, HqBroadcastRun, LineAccount, LineAccountTagSummary } from '@line-crm/shared'
import { CreatePage } from '@/components/templates/create-page'
import ActionMenu from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import LinePreview, { LinePreviewMessage } from '@/components/shared/line-preview'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Radio from '@/components/shared/radio'
import SectionHeader from '@/components/shared/section-header'
import SegmentedControl from '@/components/shared/segmented'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import { TextArea } from '@/components/shared/text-field'
import Checkbox from '@/components/shared/checkbox'
import { RowActions } from '@/components/shared/row-actions'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { notifyToast } from '@/components/shared/toast'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { ApiError, api } from '@/lib/api'
import { hqBroadcastsApi } from '@/lib/hq-broadcasts-api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { STORE_INSERTS, preflightBadge, splitPreflightRows, previewText, runTitle, scheduledIso, sendTotals, toApiContent } from './model'
import styles from './create.module.css'
import { japaneseDetailOf } from '@/components/shared/api-error-message'

type Store = Pick<LineAccount, 'id' | 'name' | 'tags'> & { friendCount: number }
type Mode = 'tag' | 'store'
type Kind = 'text' | 'coupon' | 'rich'

/** 表に1行ずつ出すのは4店まで。残りは「ほか N店」にまとめ、「…」から全部を開く。 */
const ROWS_SHOWN = 4

const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function tomorrow(): string {
  const d = new Date(); d.setDate(d.getDate() + 1)
  return ymd(d)
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土']

/** 選べる日：今日から 90 日先まで（絵の「1月15日（木）」の形）。 */
const DAYS = Array.from({ length: 91 }, (_, i) => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i)
  return { value: ymd(d), label: `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）` }
})

const n = (value: number) => value.toLocaleString('ja-JP')

function errorText(caught: unknown, fallback: string): string {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return '統括全体の編集権限がある人だけが一括配信を作れます。'
    if (caught.status === 409) return 'ほかの人が先に操作しました。もう一度確かめてください。'
  }
  // 「API error: 500」のような内部の文は出さない。
  return japaneseDetailOf(caught) || fallback
}

export default function HqBroadcastCreate() {
  usePageTitle('一括配信を作る')
  usePageCrumbs([{ label: '一括配信', href: '/hq/broadcasts' }])
  const router = useRouter()
  const params = useSearchParams()
  const role = useStaffRole()
  const canManage = role === null || canManageRole(role)

  const [stores, setStores] = useState<Store[] | null>(null)
  const [tags, setTags] = useState<LineAccountTagSummary[]>([])
  const [loadError, setLoadError] = useState<unknown>(null)
  const [mode, setMode] = useState<Mode>('tag')
  const [tagIds, setTagIds] = useState<string[]>(() => (params.get('tag') ? [params.get('tag')!] : []))
  const [accountIds, setAccountIds] = useState<string[]>([])
  const [excluded, setExcluded] = useState<string[]>([])
  const [kind, setKind] = useState<Kind>('text')
  const [body, setBody] = useState('')
  const [when, setWhen] = useState<'now' | 'later'>('later')
  const [date, setDate] = useState(tomorrow)
  const [time, setTime] = useState('11:00')
  const [run, setRun] = useState<HqBroadcastRun | null>(null)
  const [runKey, setRunKey] = useState('')
  const [checks, setChecks] = useState<HqBroadcastPreflight[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [error, setError] = useState('')
  const [storesOpen, setStoresOpen] = useState(false)
  const [insertOpen, setInsertOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const insertRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let current = true
    void Promise.all([api.lineAccounts.list(), api.lineAccountTags.list().catch(() => null)])
      .then(([accounts, tagList]) => {
        if (!current) return
        if (!accounts.success) throw new Error(accounts.error)
        setStores(accounts.data
          .filter((a) => !a.archivedAt)
          .map((a) => ({ id: a.id, name: a.name, tags: a.tags ?? [], friendCount: a.stats?.friendCount ?? 0 })))
        if (tagList?.success) setTags(tagList.data)
      })
      .catch((caught) => { if (current) setLoadError(caught) })
    return () => { current = false }
  }, [])

  const tagCount = useCallback((tagId: string) => (stores ?? []).filter((s) => s.tags?.some((t) => t.id === tagId)).length, [stores])
  const chosen = useMemo(() => {
    const list = stores ?? []
    return mode === 'tag'
      ? list.filter((s) => s.tags?.some((t) => tagIds.includes(t.id)))
      : list.filter((s) => accountIds.includes(s.id))
  }, [stores, mode, tagIds, accountIds])
  const sending_ = chosen.filter((s) => !excluded.includes(s.id))
  const friendTotal = sending_.reduce((sum, s) => sum + s.friendCount, 0)

  const scheduledAt = when === 'now' ? null : scheduledIso(date, time)
  const input: Omit<HqBroadcastInput, 'requestId'> = {
    title: runTitle(body),
    messageType: 'text',
    messageContent: toApiContent(body),
    accountIds: mode === 'store' ? accountIds : [],
    accountTagIds: mode === 'tag' ? tagIds : [],
    excludedAccountIds: excluded.filter((id) => chosen.some((s) => s.id === id)),
    audience: { kind: 'all' },
    scheduledAt,
  }
  const key = JSON.stringify(input)
  const stale = !!run && runKey !== key
  const ready = chosen.length > 0 && body.trim().length > 0 && kind === 'text' && (when === 'now' || !!scheduledAt)
  const missing = chosen.length === 0 ? '宛先の店を選んでください' : !body.trim() ? '本文を入れてください' : kind !== 'text' ? '文章で送ってください' : when === 'later' && !scheduledAt ? '送る日時を選んでください' : ''

  /** 作る（下書きを固定）→ 確かめる → 問題のある店を外す。中身が変わったら作り直し、前の下書きは取り消す。 */
  const check = async (): Promise<{ run: HqBroadcastRun; checks: HqBroadcastPreflight[] } | null> => {
    if (!ready) { setError(missing); return null }
    setChecking(true); setError('')
    try {
      let current = run
      if (!current || runKey !== key) {
        if (current && current.status === 'prepared') await hqBroadcastsApi.cancel(current.id, current.version).catch(() => null)
        const created = await hqBroadcastsApi.create({ ...input, requestId: crypto.randomUUID() })
        current = created.data
      }
      let list = (await hqBroadcastsApi.preflight(current.id)).data
      const blocked = list.filter((p) => p.blockedReasons.length > 0 && !p.excluded).map((p) => p.accountId)
      if (blocked.length > 0) {
        const ids = [...new Set([...list.filter((p) => p.excluded).map((p) => p.accountId), ...blocked])]
        current = (await hqBroadcastsApi.exclude(current.id, ids, current.version)).data
        list = list.map((p) => (ids.includes(p.accountId) ? { ...p, excluded: true } : p))
      }
      setRun(current); setRunKey(key); setChecks(list)
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
      setRunKey(JSON.stringify({ ...input, excludedAccountIds: ids.filter((id) => chosen.some((s) => s.id === id)) }))
    } catch (caught) {
      setError(errorText(caught, '店を外せませんでした。もう一度お試しください。'))
    }
  }

  const saveDraft = async () => {
    const result = await check()
    if (!result) return
    notifyToast('下書きに保存しました')
    setLeaving(true)
    router.push(`/hq/broadcasts/detail?id=${encodeURIComponent(result.run.id)}`)
  }

  const askSend = async () => {
    const result = !run || stale || !checks ? await check() : { run, checks }
    if (!result) return
    if (sendTotals(result.checks).sendStores === 0) { setError('送れる店がありません。外した店の問題を直すか、宛先を変えてください。'); return }
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

  const insert = (label: string) => {
    const el = document.getElementById('hq-bc-body') as HTMLTextAreaElement | null
    const at = el ? el.selectionStart : body.length
    setBody((text) => `${text.slice(0, at)}${label}${text.slice(at)}`)
    setInsertOpen(false)
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + label.length, at + label.length) })
  }

  /* 本文か宛先を入れたまま、送る・下書きに保存する前に離れるときは確かめる。 */
  const [leaving, setLeaving] = useState(false)
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty: !leaving && (body.trim().length > 0 || tagIds.length > 0 || accountIds.length > 0), busy: checking || sending })

  const totals = checks && !stale ? sendTotals(checks) : null
  const sendCount = totals ? totals.sendStores : sending_.length
  const { shown, rest } = splitPreflightRows(checks ?? [], showAll ? Infinity : ROWS_SHOWN)
  const exampleStore = (checks ?? []).find((p) => !p.excluded && !p.blockedReasons.length)?.accountName ?? sending_[0]?.name ?? '店の名前'

  if (!canManage) {
    return (
      <CreatePage boardId="p17Qku" headingSize="compact" title="一括配信を作る" footerActions={null}>
        <Notice tone="info">一括配信を作れるのは、統括全体の編集権限がある人（オーナー・管理者）だけです。</Notice>
      </CreatePage>
    )
  }

  const preview = (
    <div className={styles.previewCol}>
      <LinePreview accountName={exampleStore} caption="今日" note={`${exampleStore}の例です。差し込みは店ごとに変わります（{予約ページ}は省いて見せています）。`}>
        <LinePreviewMessage accountName={exampleStore} avatar={exampleStore.slice(0, 1)} time={when === 'now' ? '今' : time}>
          {previewText(body, exampleStore) || '（本文がまだありません）'}
        </LinePreviewMessage>
      </LinePreview>
    </div>
  )

  return (
    <>
      <div className={styles.screen}>
      <CreatePage
        boardId="p17Qku"
        headingSize="compact"
        title="一括配信を作る"
        help="選んだアカウント（店）に、同じ内容を一度に送ります。各店のアカウントに入らずに送れます。店ごとに変わる差し込みは、送る店の名前・共通情報に置き換わります。"
        preview={preview}
        status={stale ? <span aria-live="polite">中身を変えたので、送る前にもう一度確かめます</span> : undefined}
        footerActions={(
          <>
            <Button href="/hq/broadcasts">キャンセル</Button>
            <Button onClick={() => void saveDraft()} disabled={checking || sending} title={missing || undefined}>下書きに保存</Button>
            <Button variant="primary" onClick={() => void askSend()} busy={checking} busyLabel="確かめています…" disabled={sending} title={missing || undefined}>
              <Send size={15} aria-hidden="true" />{`${n(sendCount)}店に送る`}
            </Button>
          </>
        )}
      >
        <div className={styles.body}>
          {error ? <Notice tone="danger" role="alert">{error}</Notice> : null}

          <section className={styles.section} aria-label="① 宛先">
            <SectionHeader title="① 宛先" help="アカウントのタグ（統括の分類）でまとめて選ぶか、店を1つずつ選びます。送る直前の店の組み合わせで固定され、あとでタグに店が増えてもこの配信には入りません。" helpLabel="宛先の説明" />
            <div className={styles.radios} role="radiogroup" aria-label="宛先の選び方">
              <Radio name="hq-bc-mode" checked={mode === 'tag'} onChange={() => setMode('tag')}>アカウントのタグで選ぶ</Radio>
              <Radio name="hq-bc-mode" checked={mode === 'store'} onChange={() => setMode('store')}>店を1つずつ選ぶ</Radio>
            </div>
            {loadError && !stores ? <ListState kind="error" error={loadError} onRetry={() => window.location.reload()} /> : !stores ? <ListState kind="loading" /> : (
              <div className={styles.chips}>
                {(mode === 'tag' ? tags.map((t) => ({ id: t.id, label: `${t.name}（${tagCount(t.id)}店）`, on: tagIds.includes(t.id), toggle: () => setTagIds((ids) => (ids.includes(t.id) ? ids.filter((x) => x !== t.id) : [...ids, t.id])) }))
                  : stores.map((s) => ({ id: s.id, label: s.name, on: accountIds.includes(s.id), toggle: () => setAccountIds((ids) => (ids.includes(s.id) ? ids.filter((x) => x !== s.id) : [...ids, s.id])) })))
                  .map((chip) => (
                    <button key={chip.id} type="button" className={chip.on ? `${styles.pick} ${styles.pickOn}` : styles.pick} aria-pressed={chip.on} onClick={chip.toggle} title={chip.label}>
                      {chip.on ? <Check size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}{chip.label}
                    </button>
                  ))}
                {mode === 'tag' && tags.length === 0 ? <span className={styles.muted}>アカウントのタグがまだありません。統括の「アカウント」でタグを作るか、店を1つずつ選んでください。</span> : null}
              </div>
            )}
            <div className={styles.count}>
              <span className={styles.countItem}><span className={styles.countNum}>{n(sending_.length)}</span><span className={styles.countUnit}>店</span></span>
              <span className={styles.countItem}><span className={styles.countNum}>{n(friendTotal)}</span><span className={styles.countUnit}>人（友だちの合計）</span></span>
              <span className={styles.spacer} />
              <Button variant="text" onClick={() => setStoresOpen(true)} disabled={chosen.length === 0}><ListFilter size={15} aria-hidden="true" />店を見る・外す</Button>
            </div>
          </section>

          <section className={styles.section} aria-label="② 中身">
            <SectionHeader title="② 中身" help="店ごとに変わる差し込みは、送るときに店の名前や店の共通情報へ置き換わります。店の共通情報が無い店は、送る前の確かめで止まります。" helpLabel="中身の説明" />
            <SegmentedControl<Kind>
              aria-label="中身の種類"
              value={kind}
              onChange={setKind}
              options={[{ value: 'text', label: '文章' }, { value: 'coupon', label: 'クーポン' }, { value: 'rich', label: 'リッチメッセージ' }]}
            />
            {kind !== 'text' ? (
              <Notice tone="info" role="status">統括からのクーポン・リッチメッセージの一括配信は、まだ使えません。文章で送ってください。</Notice>
            ) : (
              <>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>本文</span>
                  <TextArea id="hq-bc-body" className={styles.textarea} value={body} onChange={(event) => setBody(event.target.value)} placeholder="{店名}より：…" maxLength={5000} aria-required="true" />
                </label>
                <div className={styles.inserts}>
                  <span className={styles.muted}>店ごとに変わる差し込み</span>
                  {STORE_INSERTS.map((item) => (
                    <button key={item.label} type="button" className={styles.insertChip} title={item.help} onClick={() => insert(item.label)}>{item.label}</button>
                  ))}
                  <span className={styles.insertMenu}>
                    <Button variant="text" ref={insertRef} onClick={() => setInsertOpen((open) => !open)} aria-expanded={insertOpen}><Plus size={15} aria-hidden="true" />差し込みを入れる</Button>
                    <ActionMenu open={insertOpen} anchorRef={insertRef} onClose={() => setInsertOpen(false)} ariaLabel="差し込みを入れる"
                      items={STORE_INSERTS.map((item) => ({ id: item.label, label: `${item.label}（${item.help}）`, onSelect: () => insert(item.label) }))} />
                  </span>
                </div>
              </>
            )}
          </section>

          <section className={styles.section} aria-label="③ 送る時刻">
            <SectionHeader title="③ 送る時刻" help="全店に同じ時刻で送ります。予約した配信は、送る前なら一括配信の詳細から止められます。" helpLabel="送る時刻の説明" />
            <div className={styles.timeRow} role="radiogroup" aria-label="送る時刻">
              <Radio name="hq-bc-when" checked={when === 'now'} onChange={() => setWhen('now')}>すぐ送る</Radio>
              <Radio name="hq-bc-when" checked={when === 'later'} onChange={() => setWhen('later')}>予約する</Radio>
              {when === 'later' ? (
                <>
                  <span className={styles.dateBox}><Select aria-label="送る日" value={date} onChange={setDate} options={DAYS} /></span>
                  <span className={styles.timeBox}><Select aria-label="送る時刻" value={time} onChange={setTime} options={TIMES.map((t) => ({ value: t, label: t }))} /></span>
                </>
              ) : null}
              <span className={styles.muted}>全店同じ時刻に送ります</span>
            </div>
          </section>

          <section className={styles.section} aria-label="④ 送る前の確かめ">
            <SectionHeader title="④ 送る前の確かめ" help="店ごとに、送る人数・今月の送信枠の残り・LINE の接続・配信を止めていないかを確かめます。問題のある店は外して送ります。" helpLabel="送る前の確かめの説明" />
            <div className={styles.band}>
              <Info size={16} aria-hidden="true" className={styles.bandIcon} />
              <span className={styles.bandText}>送信枠が足りない店・LINE の接続が切れている店・配信を止めている店は外して送ります。直すと次から送れます。</span>
            </div>
            {!checks || stale ? (
              <div className={styles.checkEmpty}>
                <span className={styles.muted}>{stale ? '中身・宛先・時刻を変えました。もう一度確かめてください。' : missing || '店ごとの人数と送信枠の残りを確かめます。'}</span>
                <Button onClick={() => void check()} busy={checking} busyLabel="確かめています…" disabled={!ready}>送る前に確かめる</Button>
              </div>
            ) : (
              <>
                <DataTable className={styles.table} data-design="hq-broadcast-preflight">
                  <thead>
                    <TableHeadRow className={styles.headRow}>
                      <Th className={styles.colStore}>店</Th>
                      <Th className={styles.colPeople}>送る人数</Th>
                      <Th className={styles.colQuota}>今月の送信枠の残り</Th>
                      <Th className={styles.colCheck}>確かめ</Th>
                      <Th className={styles.colSend}>送るか</Th>
                      <Th className={styles.colMenu}><span className="sr-only">操作</span></Th>
                    </TableHeadRow>
                  </thead>
                  <tbody>
                    {shown.map((p) => {
                      const badge = preflightBadge(p)
                      const go = !p.excluded && p.blockedReasons.length === 0
                      return (
                        <Tr key={p.accountId} className={styles.row}>
                          <Td className={styles.colStore}><span className={styles.store} title={p.accountName}>{p.accountName}</span></Td>
                          <Td className={styles.colPeople}><span className={styles.num}>{p.audienceCount === null ? '—' : `${n(p.audienceCount)}人`}</span></Td>
                          <Td className={styles.colQuota}><span className={styles.sub}>{p.remaining === null ? '—' : `${n(p.remaining)}通`}</span></Td>
                          <Td className={styles.colCheck}><StatusBadge tone={badge.tone} title={p.blockedReasons.join('・') || undefined}>{badge.label}</StatusBadge></Td>
                          <Td className={styles.colSend}><StatusBadge tone={go ? 'success' : 'neutral'}>{go ? '送る' : '外す'}</StatusBadge></Td>
                          <Td className={styles.colMenu}>
                            <RowActions
                              subjectName={p.accountName}
                              menuItems={p.blockedReasons.length > 0
                                ? [{ id: 'why', label: `外す理由：${p.blockedReasons.join('・')}`, disabled: true, disabledReason: '直すと次から送れます', onSelect: () => {} }]
                                : [{ id: 'toggle', label: p.excluded ? 'この店に送る' : 'この店を外す', onSelect: () => void toggleExclude(p) }]}
                            />
                          </Td>
                        </Tr>
                      )
                    })}
                    {rest.length > 0 ? (
                      <Tr className={styles.row}>
                        <Td className={styles.colStore}><span className={styles.store}>{`ほか ${rest.length}店`}</span></Td>
                        <Td className={styles.colPeople}><span className={styles.num}>{`${n(rest.reduce((sum, p) => sum + (p.audienceCount ?? 0), 0))}人`}</span></Td>
                        <Td className={styles.colQuota}><span className={styles.sub}>—</span></Td>
                        <Td className={styles.colCheck}><StatusBadge tone="success">すべて足りる</StatusBadge></Td>
                        <Td className={styles.colSend}><StatusBadge tone="success">送る</StatusBadge></Td>
                        <Td className={styles.colMenu}>
                          <RowActions subjectName={`ほか ${rest.length}店`} menuItems={[{ id: 'all', label: '1店ずつ見る', onSelect: () => setShowAll(true) }]} />
                        </Td>
                      </Tr>
                    ) : null}
                  </tbody>
                </DataTable>
                {totals ? (
                  <p className={styles.totals}>
                    <span className={styles.totalSend}>{`送る：${n(totals.sendStores)}店・${n(totals.sendPeople)}人`}</span>
                    <span className={styles.totalSkip}>{`外す：${n(totals.skipStores)}店・${n(totals.skipPeople)}人`}</span>
                  </p>
                ) : null}
              </>
            )}
          </section>
        </div>
      </CreatePage>
      </div>

      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        subject="一括配信の下書き"
        busy={checking || sending}
        onCancel={() => { if (!checking && !sending) cancelLeave() }}
        onConfirm={() => { confirmLeave() }}
      />

      <Dialog
        open={storesOpen}
        title="送る店"
        description="チェックを外した店には送りません。外した店は、送る前の確かめの表にも「外す」で出ます。"
        confirmLabel="閉じる"
        onConfirm={() => setStoresOpen(false)}
        onCancel={() => setStoresOpen(false)}
      >
        <ul className={styles.storeList}>
          {chosen.map((s) => (
            <li key={s.id} className={styles.storeItem}>
              <Checkbox
                checked={!excluded.includes(s.id)}
                onCheckedChange={(on) => setExcluded((ids) => (on ? ids.filter((x) => x !== s.id) : [...ids, s.id]))}
              >{`${s.name}（${n(s.friendCount)}人）`}</Checkbox>
            </li>
          ))}
        </ul>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title={`${n(totals?.sendStores ?? 0)}店に送ります`}
        description={`${n(totals?.sendPeople ?? 0)}人に${when === 'now' ? 'すぐ' : `${date.replaceAll('-', '/')} ${time} に`}送ります。送った LINE は取り消せません。${totals && totals.skipStores ? `外した${n(totals.skipStores)}店には送りません。` : ''}`}
        confirmLabel={when === 'now' ? '送る' : '予約する'}
        busy={sending}
        warning
        onConfirm={() => void send()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}

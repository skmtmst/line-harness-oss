'use client'

/*
 * ★V8 来店スタンプ（提案 E-7・Pencil `w4SBbv`）。マイル（オンライン・特定の動き）とは別のスタンプカード。
 *
 * 頭（題・？／押せる店・店員の暗証番号）→ ①カードの設定 と ②たまる決まり（横に2枚）→
 * ③紙のカードからの移行の申請（表）と 店で手入力（右の欄）→ ④押した・使った記録 → 下の帯（キャンセル・保存する）。
 * ①② は下書きで、下の帯の［保存する］でまとめて保存する。③・店で手入力・④の取り消しは、その場で口を呼ぶ。
 * 呼ぶ口は visit-stamps-api（Codex の API-7）だけ。動き・権限は BEHAVIOR.md。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, ImageIcon, KeyRound, Minus, Plus, Stamp, Store } from 'lucide-react'
import type { VisitStampCard, VisitStampEntry, VisitStampMultiplier, VisitStampReward, VisitStampSettings } from '@line-crm/shared'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import tpl from '@/components/templates/page-templates.module.css'
import Button from '@/components/shared/button'
import Combobox from '@/components/shared/combobox'
import HelpTip from '@/components/shared/help-tip'
import IconButton from '@/components/shared/icon-button'
import ListState from '@/components/shared/list-state'
import Radio from '@/components/shared/radio'
import { RowActions } from '@/components/shared/row-actions'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import StickyBar from '@/components/shared/sticky-bar'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import Toggle from '@/components/shared/toggle'
import { notifyToast } from '@/components/shared/toast'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { visitStampsApi } from '@/lib/visit-stamps-api'
import {
  MANUAL_REASONS, type ManualReason, defaultSettings, expiryLabel, friendLabel, friendNames, historyRows, manualReasonText,
  multiplierDetail, multiplierName, previewSlots, rankDetail, rewardNote, settingsProblem, shortDateTime, slotCount, sortedRewards, withSlotCount,
} from './display'
import { BonusDialog, MultiplierDialog, PhotoDialog, PinDialog, RankDialog, ReasonDialog, RewardDialog, StoresDialog } from './dialogs'
import styles from './visit-stamps.module.css'

type PaperRow = { id: string; card_id?: string; friend_id: string; photo_url: string; stamps: number; status: string; created_at?: string }
type FriendLite = { id: string; displayName?: string | null; metadata?: Record<string, unknown> | null }

const SLOT_OPTIONS = [5, 6, 8, 10, 12, 15, 20, 30].map((n) => ({ value: String(n), label: `${n} 個` }))
const EXPIRY_OPTIONS = [{ value: 'none', label: expiryLabel(null) }, ...[3, 6, 12, 24].map((n) => ({ value: String(n), label: expiryLabel(n) }))]
const CAP_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 20].map((n) => ({ value: String(n), label: `1回 ${n}個まで` }))
const HISTORY_SHORT = 5

const message = (caught: unknown, fallback: string) => (caught instanceof Error && caught.message && !/^API \d+/.test(caught.message) ? caught.message : fallback)
const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`)

function SectionTitle({ children, help, extra }: { children: string; help: string; extra?: React.ReactNode }) {
  return (
    <div className={styles.sectionHead}>
      <h3 className={styles.sectionTitle}>{children}</h3>
      <HelpTip label={`${children}の説明`}>{help}</HelpTip>
      {extra ? <><span className={styles.grow} aria-hidden="true" />{extra}</> : null}
    </div>
  )
}

export default function VisitStampsV8() {
  usePageTitle('来店スタンプ')
  const { selectedAccountId, accounts } = useAccount()
  const role = useStaffRole()
  /* 役割が分かるまでは出す（最後の守りはサーバの 403）。閲覧のみ（viewer）には変える操作を置かない。 */
  const canManage = role === null || canManageRole(role)
  const canStamp = role !== 'viewer'

  const [cards, setCards] = useState<VisitStampCard[] | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const card = useMemo(() => (cards ?? []).find((c) => selectedAccountId && c.accountIds.includes(selectedAccountId)) ?? (cards ?? [])[0] ?? null, [cards, selectedAccountId])

  const [name, setName] = useState('')
  const [settings, setSettings] = useState<VisitStampSettings>(defaultSettings)
  const [accountIds, setAccountIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const resetDraft = useCallback((c: VisitStampCard | null) => {
    setName(c?.name ?? '来店スタンプカード')
    setSettings(c?.settings ?? defaultSettings())
    setAccountIds(c?.accountIds ?? (selectedAccountId ? [selectedAccountId] : []))
  }, [selectedAccountId])

  const loadCards = useCallback(async () => {
    try {
      const res = await visitStampsApi.cards()
      setCards(res.data); setLoadError(null)
    } catch (caught) { setLoadError(caught) }
  }, [])
  useEffect(() => { void loadCards() }, [loadCards])
  useEffect(() => { if (cards) resetDraft(card) }, [cards, card, resetDraft])

  const dirty = useMemo(() => {
    const base = card ? { name: card.name, settings: card.settings, accountIds: card.accountIds } : null
    return !base || JSON.stringify(base) !== JSON.stringify({ name, settings, accountIds })
  }, [card, name, settings, accountIds])

  /* ①② の下書きを保存せずに離れるときは確かめる（保存できる人だけ。閲覧のみは変えられない）。 */
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty: canManage && !!cards && dirty && !!card, busy: saving })

  const save = async () => {
    const problem = settingsProblem(name, settings) ?? (accountIds.length ? null : '押せる店を1つ以上選んでください。')
    if (problem) { notifyToast(problem, { tone: 'error' }); return }
    setSaving(true)
    try {
      const body = { name: name.trim(), accountIds, settings, active: card?.active ?? true, expectedVersion: card?.version ?? 0 }
      if (card) await visitStampsApi.save(card.id, body)
      else await visitStampsApi.create(body)
      notifyToast('来店スタンプの設定を保存しました。')
      await loadCards()
    } catch (caught) {
      const conflict = (caught as { status?: number })?.status === 409
      notifyToast(conflict ? 'ほかの人が先に保存しました。読み直してから、もう一度変えてください。' : message(caught, '保存できませんでした。'), { tone: 'error' })
    } finally { setSaving(false) }
  }

  /* ── 友だち・担当者の名前 ── */
  const [friends, setFriends] = useState<FriendLite[]>([])
  const [friendCache, setFriendCache] = useState<Record<string, FriendLite>>({})
  const [staff, setStaff] = useState<Array<{ id: string; name: string; role: string }>>([])
  useEffect(() => {
    if (!selectedAccountId) return
    let live = true
    void api.friends.list({ accountId: selectedAccountId, limit: 200, includeTags: false })
      .then((res) => { if (live && res.success) setFriends(res.data.items as FriendLite[]) })
      .catch(() => {})
    return () => { live = false }
  }, [selectedAccountId])
  useEffect(() => {
    let live = true
    void api.staff.list().then((res) => { if (live && res.success) setStaff(res.data.map((s) => ({ id: s.id, name: s.name, role: s.role }))) }).catch(() => {})
    return () => { live = false }
  }, [])
  const staffName = useCallback((id: string) => staff.find((s) => s.id === id)?.name, [staff])
  const friendById = useCallback((id: string): FriendLite | undefined => friends.find((f) => f.id === id) ?? friendCache[id], [friendCache, friends])

  /* ── ③ 紙のカードの申請 ── */
  const [paper, setPaper] = useState<PaperRow[] | null>(null)
  const [paperError, setPaperError] = useState<unknown>(null)
  const loadPaper = useCallback(async () => {
    if (!selectedAccountId) return
    try {
      const res = await visitStampsApi.paperRequests(selectedAccountId)
      setPaper(res.data as PaperRow[]); setPaperError(null)
    } catch (caught) { setPaperError(caught) }
  }, [selectedAccountId])
  useEffect(() => { void loadPaper() }, [loadPaper])
  /* 一覧に名前が無い友だちだけ、1人ずつ読む（申請は多くても 200 件）。 */
  useEffect(() => {
    const missing = [...new Set((paper ?? []).map((p) => p.friend_id))].filter((id) => !friendById(id))
    if (!missing.length) return
    let live = true
    void Promise.allSettled(missing.slice(0, 50).map((id) => api.friends.get(id, { includeSubmissions: false }))).then((results) => {
      if (!live) return
      const add: Record<string, FriendLite> = {}
      results.forEach((r) => { if (r.status === 'fulfilled' && r.value.success) { const f = r.value.data as FriendLite; add[f.id] = f } })
      setFriendCache((prev) => ({ ...prev, ...add }))
    })
    return () => { live = false }
  }, [paper, friendById])

  const [busy, setBusy] = useState('')
  const [rejecting, setRejecting] = useState<PaperRow | null>(null)
  const [dialogError, setDialogError] = useState('')
  const [photo, setPhoto] = useState<PaperRow | null>(null)
  const review = async (row: PaperRow, action: 'approve' | 'reject', reason: string) => {
    setBusy(row.id); setDialogError('')
    try {
      await visitStampsApi.reviewPaper(row.id, action, reason)
      notifyToast(action === 'approve' ? `${row.stamps}個をカードに足しました。お客さまに LINE でお知らせします。` : '申請を却下しました。')
      setRejecting(null)
      await loadPaper()
      if (row.friend_id === friendId) await loadWallet()
    } catch (caught) {
      const text = message(caught, action === 'approve' ? '承認できませんでした。' : '却下できませんでした。')
      if (action === 'reject') setDialogError(text); else notifyToast(text, { tone: 'error' })
      await loadPaper()
    } finally { setBusy('') }
  }

  /* ── 店で手入力 ── */
  const [friendId, setFriendId] = useState('')
  const [count, setCount] = useState(1)
  const [reason, setReason] = useState<ManualReason>('paper')
  const [memo, setMemo] = useState('')
  const grantRequest = useRef(newRequestId())
  /* 友だちの詳細などから ?friend=<友だちID> で開くと、その人を選んだ状態で始める。 */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('friend')
    if (id) setFriendId(id)
  }, [])
  useEffect(() => {
    if (!friendId || friendById(friendId)) return
    let live = true
    void api.friends.get(friendId, { includeSubmissions: false }).then((res) => {
      if (live && res.success) setFriendCache((prev) => ({ ...prev, [friendId]: res.data as FriendLite }))
    }).catch(() => {})
    return () => { live = false }
  }, [friendId, friendById])
  const grant = async () => {
    if (!card || !selectedAccountId || !friendId) return
    setBusy('grant')
    try {
      await visitStampsApi.grant(card.id, {
        accountId: selectedAccountId, friendId, count, reason: manualReasonText(reason, memo),
        requestId: grantRequest.current, source: reason === 'paper' ? 'paper' : 'manual',
      })
      grantRequest.current = newRequestId()
      notifyToast(`${count}個 押しました。`)
      setCount(1); setMemo('')
      await loadWallet()
    } catch (caught) {
      notifyToast(message(caught, '押印を足せませんでした。'), { tone: 'error' })
    } finally { setBusy('') }
  }

  /* ── ④ 押した・使った記録（選んだ友だちの台帳） ── */
  const [entries, setEntries] = useState<VisitStampEntry[] | null>(null)
  const [walletError, setWalletError] = useState<unknown>(null)
  const [showAll, setShowAll] = useState(false)
  const loadWallet = useCallback(async () => {
    if (!card || !selectedAccountId || !friendId) { setEntries(null); return }
    try {
      const res = await visitStampsApi.wallet(card.id, selectedAccountId, friendId)
      setEntries(res.data.entries); setWalletError(null)
    } catch (caught) { setWalletError(caught) }
  }, [card, selectedAccountId, friendId])
  useEffect(() => { void loadWallet() }, [loadWallet])
  const rows = useMemo(() => historyRows(entries ?? [], staffName), [entries, staffName])
  const [reversing, setReversing] = useState<string | null>(null)
  const reverse = async (entryId: string, why: string) => {
    setBusy(entryId); setDialogError('')
    try {
      await visitStampsApi.reverse(entryId, why)
      notifyToast('記録を取り消しました。')
      setReversing(null)
      await loadWallet()
    } catch (caught) { setDialogError(message(caught, '取り消せませんでした。')) } finally { setBusy('') }
  }

  /* ── 下書きを変える窓 ── */
  const [rewardEdit, setRewardEdit] = useState<VisitStampReward | 'new' | null>(null)
  const [multEdit, setMultEdit] = useState<number | 'new' | null>(null)
  const [bonusOpen, setBonusOpen] = useState(false)
  const [rankOpen, setRankOpen] = useState(false)
  const [storesOpen, setStoresOpen] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)
  const [pinBusy, setPinBusy] = useState(false)
  const set = (patch: Partial<VisitStampSettings>) => setSettings((s) => ({ ...s, ...patch }))

  const savePin = async (staffId: string, pin: string) => {
    if (!selectedAccountId) return
    setPinBusy(true); setDialogError('')
    try {
      await visitStampsApi.setPin(staffId, selectedAccountId, pin)
      notifyToast(`${staffName(staffId) ?? '店員'}さんの暗証番号を保存しました。`)
      setPinOpen(false)
    } catch (caught) { setDialogError(message(caught, '暗証番号を保存できませんでした。')) } finally { setPinBusy(false) }
  }

  if (loadError && cards === null) {
    return <PageFrame kind="visit-stamps" boardId="w4SBbv"><PageHeading headingSize="compact" title="来店スタンプ" /><ListState kind="error" error={loadError} onRetry={() => void loadCards()} /></PageFrame>
  }
  if (cards === null) {
    return <PageFrame kind="visit-stamps" boardId="w4SBbv"><PageHeading headingSize="compact" title="来店スタンプ" /><ListState kind="loading" /></PageFrame>
  }

  const ro = !canManage
  const filled = Math.min(3, slotCount(settings))
  const storeNames = accounts.filter((a) => accountIds.includes(a.id)).map((a) => a.displayName || a.name)
  const shownRows = showAll ? rows : rows.slice(0, HISTORY_SHORT)
  const friendOptions = [...friends, ...Object.values(friendCache).filter((f) => !friends.some((x) => x.id === f.id))].map((f) => ({ value: f.id, label: friendLabel(f) }))
  const selectedFriend = friendById(friendId)
  const stampable = canStamp && !!card

  return (
    <PageFrame kind="visit-stamps" boardId="w4SBbv" hasFooter={canManage}>
      <PageHeading
        headingSize="compact"
        title="来店スタンプ"
        help="お店に来たお客さまへ押すスタンプカードです。マイル（オンラインでの動きにたまるもの）とは別に数えます。決まった数がたまると特典を使えます。特典はお客さまの LINE の画面を店員に見せ、店員が暗証番号を打つと使用済みになります。"
        actions={canManage ? (
          <>
            <Button size="compact" onClick={() => setStoresOpen(true)} title={storeNames.join('・')}><Store size={15} aria-hidden="true" />押せる店：{storeNames[0] ?? '未選択'}{storeNames.length > 1 ? ` ほか${storeNames.length - 1}店` : ''}</Button>
            <Button size="compact" onClick={() => { setDialogError(''); setPinOpen(true) }}><KeyRound size={15} aria-hidden="true" />店員の暗証番号</Button>
          </>
        ) : undefined}
      />
      <div className={tpl.split} data-template-region="body">
        <div className={styles.body}>
          <div className={styles.pair}>
            {/* ① カードの設定 */}
            <section className={`${styles.card} ${styles.cardTall}`} aria-label="① カードの設定">
              <SectionTitle help="カードの名前・マスの数・期限と、何個で何を渡すか（特典）を決めます。マスの数は、いちばん大きい特典の個数です。">① カードの設定</SectionTitle>
              <label className={styles.field}>
                <span className={styles.label}>カードの名前</span>
                <TextField value={name} onChange={(e) => setName(e.target.value)} readOnly={ro} maxLength={100} />
              </label>
              <div className={styles.row2}>
                <div className={styles.field}>
                  <span className={styles.label}>マスの数</span>
                  <Select aria-label="マスの数" size="full" disabled={ro} value={String(slotCount(settings))} onChange={(v) => setSettings((s) => withSlotCount(s, Number(v)))}
                    options={SLOT_OPTIONS.some((o) => o.value === String(slotCount(settings))) ? SLOT_OPTIONS : [...SLOT_OPTIONS, { value: String(slotCount(settings)), label: `${slotCount(settings)} 個` }]} />
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>有効期限</span>
                  <Select aria-label="有効期限" size="full" disabled={ro} value={settings.expiryMonths === null ? 'none' : String(settings.expiryMonths)} onChange={(v) => set({ expiryMonths: v === 'none' ? null : Number(v) })}
                    options={EXPIRY_OPTIONS.some((o) => o.value === String(settings.expiryMonths)) || settings.expiryMonths === null ? EXPIRY_OPTIONS : [...EXPIRY_OPTIONS, { value: String(settings.expiryMonths), label: expiryLabel(settings.expiryMonths) }]} />
                </div>
              </div>
              <span className={styles.label}>特典</span>
              <div className={styles.rewards}>
                {sortedRewards(settings.rewards).map((reward) => (
                  <div key={reward.id} className={styles.reward}>
                    <span className={styles.count}>{reward.stamps} 個</span>
                    <span className={styles.texts}>
                      <span className={styles.name} title={reward.name}>{reward.name}</span>
                      <span className={styles.sub}>{rewardNote(reward, settings)}</span>
                    </span>
                    {ro ? null : (
                      <RowActions subjectName={reward.name} menuItems={[{ id: 'edit', label: '特典を変える', onSelect: () => setRewardEdit(reward) }]}
                        destructiveItem={settings.rewards.length > 1 ? { id: 'delete', label: '特典を消す', onSelect: () => set({ rewards: settings.rewards.filter((r) => r.id !== reward.id) }) } : undefined} />
                    )}
                  </div>
                ))}
              </div>
              {ro || settings.rewards.length >= 20 ? null : (
                <span className={styles.addLine}><Button variant="text" onClick={() => setRewardEdit('new')}><Plus size={15} aria-hidden="true" />特典を足す</Button></span>
              )}
              <div className={styles.preview} aria-label="お客さまの見え方">
                <span className={styles.previewLabel}>お客さまの見え方</span>
                <div className={styles.slots}>
                  {previewSlots(settings, filled).map((slot) => (
                    <span key={slot.n} className={`${styles.slot} ${slot.state === 'done' ? styles.slotDone : slot.state === 'reward' ? styles.slotReward : ''}`} aria-label={slot.state === 'done' ? `${slot.n}個目 済み` : slot.state === 'reward' ? `${slot.n}個目 特典` : `${slot.n}個目`}>
                      {slot.state === 'done' ? <Check size={16} aria-hidden="true" /> : slot.state === 'reward' ? '特典' : slot.n}
                    </span>
                  ))}
                </div>
              </div>
            </section>

            {/* ② たまる決まり */}
            <section className={`${styles.card} ${styles.cardTall} ${styles.cardRules}`} aria-label="② たまる決まり">
              <SectionTitle help="来店1回ごとか、会計の金額ごとかを選びます。倍率は 曜日・時間・期間 で決め、いくつも当たるときはかけ合わせます。会員ランクは当たる中でいちばん高い倍率だけを使います。最後に1回の上限で切ります（上限は1つで、倍率を重ねたあとにかかります）。">② たまる決まり</SectionTitle>
              <div className={styles.radio} role="radiogroup" aria-label="たまり方">
                <Radio name="stamp-mode" checked={settings.mode === 'visit'} disabled={ro} onChange={() => set({ mode: 'visit' })}>来店 1回で 1個</Radio>
                <Radio name="stamp-mode" checked={settings.mode === 'amount'} disabled={ro} onChange={() => set({ mode: 'amount' })}>会計の金額で</Radio>
              </div>
              {settings.mode === 'amount' ? (
                <div className={`${styles.row2} ${styles.amount}`}>
                  <label className={styles.field}>
                    <span className={styles.label}>何円ごとに 1個</span>
                    <TextField value={`${settings.amountUnit.toLocaleString('ja-JP')} 円`} readOnly={ro} inputMode="numeric"
                      onChange={(e) => { const n = Number(e.target.value.replace(/[^\d]/g, '')); set({ amountUnit: Number.isFinite(n) ? n : 0 }) }} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>1回の上限</span>
                    <TextField value={`${settings.maxPerVisit} 個`} readOnly={ro} inputMode="numeric"
                      onChange={(e) => { const n = Number(e.target.value.replace(/[^\d]/g, '')); set({ maxPerVisit: Number.isFinite(n) ? n : 0 }) }} />
                  </label>
                </div>
              ) : null}
              <span className={styles.label}>倍率・ボーナス</span>
              {settings.multipliers.map((m, i) => (
                <div key={i} className={styles.switchRow}>
                  <Toggle checked label={`${multiplierName(m)}を使う`} locked={ro} onChange={ro ? undefined : () => set({ multipliers: settings.multipliers.filter((_, k) => k !== i) })} />
                  <span className={styles.texts}>
                    <span className={styles.name}>{multiplierName(m)}</span>
                    <span className={styles.sub} title={multiplierDetail(m)}>{multiplierDetail(m)}</span>
                  </span>
                  {ro ? null : <RowActions subjectName={multiplierName(m)} menuItems={[{ id: 'edit', label: '倍率を変える', onSelect: () => setMultEdit(i) }]}
                    destructiveItem={{ id: 'delete', label: '倍率を消す', onSelect: () => set({ multipliers: settings.multipliers.filter((_, k) => k !== i) }) }} />}
                </div>
              ))}
              <div className={styles.switchRow}>
                <Toggle checked={settings.firstVisitBonus > 0} label="初回来店ボーナスを使う" locked={ro && settings.firstVisitBonus > 0} onChange={ro ? undefined : (on) => set({ firstVisitBonus: on ? 1 : 0 })} />
                <span className={styles.texts}>
                  <span className={styles.name}>初回来店ボーナス</span>
                  <span className={styles.sub}>{settings.firstVisitBonus > 0 ? `はじめての来店で +${settings.firstVisitBonus}個` : 'はじめての来店で多めに押します'}</span>
                </span>
                {ro ? null : <RowActions subjectName="初回来店ボーナス" menuItems={[{ id: 'edit', label: '個数を変える', onSelect: () => setBonusOpen(true) }]} />}
              </div>
              <div className={styles.switchRow}>
                <Toggle checked={settings.rankMultipliers.length > 0} label="会員ランクの倍率を使う" locked={ro && settings.rankMultipliers.length > 0} onChange={ro ? undefined : (on) => (on ? setRankOpen(true) : set({ rankMultipliers: [] }))} />
                <span className={styles.texts}>
                  <span className={styles.name}>会員ランクの倍率</span>
                  <span className={styles.sub} title={rankDetail(settings)}>{rankDetail(settings)}</span>
                </span>
                {ro ? null : <RowActions subjectName="会員ランクの倍率" menuItems={[{ id: 'edit', label: 'ランクと倍率を変える', onSelect: () => setRankOpen(true) }]} />}
              </div>
              <div className={styles.row2}>
                <div className={styles.field}>
                  <span className={styles.label}>重ねたときの順番</span>
                  {/* 計算の順はサーバが決めている（時間の倍率はかけ合わせ、ランクはいちばん高い倍率だけ）。選べないので1つだけ出す。 */}
                  <Select aria-label="重ねたときの順番" size="full" disabled value="fixed" onChange={() => {}} options={[{ value: 'fixed', label: 'かけ合わせる（ランクは高い方）' }]} />
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>重ねたときの上限</span>
                  <Select aria-label="重ねたときの上限" size="full" disabled={ro} value={String(settings.maxPerVisit)} onChange={(v) => set({ maxPerVisit: Number(v) })}
                    options={CAP_OPTIONS.some((o) => o.value === String(settings.maxPerVisit)) ? CAP_OPTIONS : [...CAP_OPTIONS, { value: String(settings.maxPerVisit), label: `1回 ${settings.maxPerVisit}個まで` }]} />
                </div>
              </div>
              {ro || settings.multipliers.length >= 20 ? null : (
                <span className={styles.addLine}><Button variant="text" onClick={() => setMultEdit('new')}><Plus size={15} aria-hidden="true" />倍率を足す</Button></span>
              )}
            </section>
          </div>

          <div className={styles.paperRow}>
            {/* ③ 紙のカードからの移行の申請 */}
            <section className={styles.section} aria-label="③ 紙のカードからの移行の申請">
              <SectionTitle help="お客さまが LINE から送った紙のスタンプカードの写真です。写真の押印数を確かめて［承認］すると、その数をカードに足します。承認は1回だけで、同じ申請を2回は足しません。">③ 紙のカードからの移行の申請</SectionTitle>
              {paperError && paper === null ? <ListState kind="error" error={paperError} onRetry={() => void loadPaper()} />
                : paper === null ? <ListState kind="loading" />
                  : paper.length === 0 ? <p className={styles.empty}>まだ申請はありません。お客さまが LINE の来店スタンプから［紙のカードを移す］を押すと、ここに出ます。</p>
                    : (
                      <DataTable className={styles.table} data-design="visit-stamp-paper">
                        <thead>
                          <TableHeadRow className={styles.headRow}>
                            <Th className={styles.colPhoto}>写真</Th>
                            <Th>お客さま</Th>
                            <Th className={styles.colStamps}>押印数</Th>
                            <Th className={styles.colDate}>申請日</Th>
                            <Th className={styles.colState}>状態・操作</Th>
                          </TableHeadRow>
                        </thead>
                        <tbody>
                          {paper.map((row) => {
                            const f = friendById(row.friend_id)
                            const names = f ? friendNames(f) : { name: '友だち', line: null }
                            return (
                              <Tr key={row.id} className={`${styles.row} ${styles.paperLine}`}>
                                <Td className={styles.colPhoto}>
                                  <button type="button" className={styles.thumb} onClick={() => setPhoto(row)} aria-label={`${names.name}さんの写真を大きく見る`}>
                                    {/^https:\/\//.test(row.photo_url) ? <img src={row.photo_url} alt="" /> : <ImageIcon size={16} aria-hidden="true" />}
                                  </button>
                                </Td>
                                <Td>
                                  <span className={styles.texts}>
                                    <span className={styles.name}>{names.name}</span>
                                    {names.line ? <span className={styles.sub}>{`LINE：${names.line}`}</span> : null}
                                  </span>
                                </Td>
                                <Td className={styles.colStamps}><span className={styles.strong}>{row.stamps} 個</span></Td>
                                <Td className={styles.colDate}><span className={styles.muted}>{row.created_at ? shortDateTime(row.created_at) : '—'}</span></Td>
                                <Td className={styles.colState}>
                                  <span className={styles.actions}>
                                    <StatusBadge tone={row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'neutral' : 'warning'}>
                                      {row.status === 'approved' ? '承認済み' : row.status === 'rejected' ? '却下' : '確認待ち'}
                                    </StatusBadge>
                                    <span className={styles.grow} aria-hidden="true" />
                                    {row.status === 'pending' && canStamp ? (
                                      <>
                                        <Button size="compact" disabled={!!busy} onClick={() => { setDialogError(''); setRejecting(row) }}>却下</Button>
                                        <Button size="compact" disabled={!!busy} onClick={() => void review(row, 'approve', '紙のカードの写真を確認しました')} aria-label={`${names.name}さんの ${row.stamps}個を承認`}><Check size={15} aria-hidden="true" />承認</Button>
                                      </>
                                    ) : null}
                                    <RowActions subjectName={`${names.name}さんの申請`} menuItems={[
                                      { id: 'photo', label: '写真を大きく見る', onSelect: () => setPhoto(row) },
                                      { id: 'friend', label: '友だちの詳細を開く', external: true, onSelect: () => { window.location.href = `/friends/detail?id=${encodeURIComponent(row.friend_id)}` } },
                                    ]} />
                                  </span>
                                </Td>
                              </Tr>
                            )
                          })}
                        </tbody>
                      </DataTable>
                    )}
            </section>

            {/* 店で手入力 */}
            <section className={styles.side} aria-label="店で手入力">
              <h3 className={styles.sectionTitle}>店で手入力</h3>
              {!card ? <p className={styles.sub}>カードを保存すると、店で押せるようになります。</p> : null}
              <div className={styles.field}>
                <span className={styles.label}>友だち</span>
                <Combobox key={selectedFriend ? `f-${friendId}` : 'none'} aria-label="友だちを探す" placeholder="名前で探す" value={friendId} onChange={(v) => { setFriendId(v); setShowAll(false) }} options={friendOptions}
                  disabled={!card} emptyText={(q) => `「${q}」に合う友だちはいません`} />
              </div>
              {stampable ? (
                <>
                  <div className={styles.field}>
                    <span className={styles.label}>押印数</span>
                    <span className={styles.stepper}>
                      <IconButton aria-label="1個へらす" disabled={count <= 1} onClick={() => setCount((c) => Math.max(1, c - 1))}><Minus size={16} aria-hidden="true" /></IconButton>
                      <span className={styles.stepValue} aria-live="polite">{`＋${count} 個`}</span>
                      <IconButton aria-label="1個ふやす" disabled={count >= 100} onClick={() => setCount((c) => Math.min(100, c + 1))}><Plus size={16} aria-hidden="true" /></IconButton>
                    </span>
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>理由</span>
                    <Select aria-label="理由" size="full" value={reason} onChange={(v) => setReason(v as ManualReason)} options={MANUAL_REASONS.map((r) => ({ value: r.value, label: r.label }))} />
                  </div>
                  <label className={styles.field}>
                    <span className={styles.label}>メモ<span className={styles.optional}>任意</span></span>
                    <TextField value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} placeholder="例：レシートを確認済み" />
                  </label>
                  <span className={styles.addLine}>
                    <Button disabled={!friendId || busy === 'grant'} onClick={() => void grant()} title={friendId ? undefined : '先に友だちを選んでください'}><Stamp size={15} aria-hidden="true" />押印を足す</Button>
                  </span>
                </>
              ) : null}
            </section>
          </div>

          {/* ④ 押した・使った記録 */}
          <section className={styles.section} aria-label="④ 押した・使った記録">
            <SectionTitle
              help="選んだ友だちのカードの台帳です。来店・会計で自動で押したもの、店で足したもの、紙のカードから移したもの、特典で使ったものが並びます。まちがいは「…」から取り消せます（取り消しも記録に残ります）。"
              extra={rows.length > HISTORY_SHORT ? <button type="button" className={styles.link} onClick={() => setShowAll((v) => !v)}>{showAll ? '少なく見る' : 'すべて見る'}<ArrowRight size={14} aria-hidden="true" /></button> : undefined}
            >④ 押した・使った記録</SectionTitle>
            {!friendId ? <p className={styles.empty}>「店で手入力」で友だちを選ぶと、その人の記録が出ます。</p>
              : walletError && entries === null ? <ListState kind="error" error={walletError} onRetry={() => void loadWallet()} />
                : entries === null ? <ListState kind="loading" />
                  : rows.length === 0 ? <p className={styles.empty}>{`${selectedFriend ? friendNames(selectedFriend).name : 'この友だち'}さんの記録はまだありません。`}</p>
                    : (
                      <DataTable className={styles.table} data-design="visit-stamp-history">
                        <thead>
                          <TableHeadRow className={styles.headRow}>
                            <Th className={styles.colWhen}>いつ</Th>
                            <Th>誰に</Th>
                            <Th className={styles.colCount}>何個</Th>
                            <Th className={styles.colWhy}>何で</Th>
                            <Th className={styles.colActor}>誰が</Th>
                            <Th className={styles.colMenu}><span className="sr-only">操作</span></Th>
                          </TableHeadRow>
                        </thead>
                        <tbody>
                          {shownRows.map((row) => (
                            <Tr key={row.id} className={styles.row}>
                              <Td className={styles.colWhen}><span className={styles.plain}>{shortDateTime(row.at)}</span></Td>
                              <Td><span className={styles.name}>{selectedFriend ? friendNames(selectedFriend).name : '友だち'}</span></Td>
                              <Td className={styles.colCount}><span className={`${styles.countText} ${row.reversed ? styles.countReversed : ''}`}>{row.count}</span></Td>
                              <Td className={styles.colWhy}><span className={styles.muted} title={row.why}>{row.why}</span></Td>
                              <Td className={styles.colActor}><span className={styles.muted} title={row.actor}>{row.actor}</span></Td>
                              <Td className={styles.colMenu}>
                                <RowActions subjectName={`${shortDateTime(row.at)} の記録`}
                                  menuItems={[{ id: 'friend', label: '友だちの詳細を開く', external: true, onSelect: () => { window.location.href = `/friends/detail?id=${encodeURIComponent(friendId)}` } }]}
                                  destructiveItem={canManage && row.reversible ? { id: 'reverse', label: 'この記録を取り消す', onSelect: () => { setDialogError(''); setReversing(row.id) } } : undefined} />
                              </Td>
                            </Tr>
                          ))}
                        </tbody>
                      </DataTable>
                    )}
          </section>
        </div>
      </div>
      {canManage ? (
        <div className={tpl.footer} data-template-region="footer">
          <StickyBar
            status={dirty ? '保存していない変更があります' : undefined}
            actions={(
              <>
                <Button disabled={!dirty || saving} onClick={() => resetDraft(card)}>キャンセル</Button>
                <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}><Check size={15} aria-hidden="true" />保存する</Button>
              </>
            )}
          />
        </div>
      ) : null}

      <RewardDialog open={rewardEdit !== null} reward={rewardEdit === 'new' ? null : rewardEdit} onClose={() => setRewardEdit(null)}
        onSave={(reward) => { set({ rewards: rewardEdit === 'new' ? [...settings.rewards, reward] : settings.rewards.map((r) => (r.id === reward.id ? reward : r)) }); setRewardEdit(null) }} />
      <MultiplierDialog open={multEdit !== null} multiplier={typeof multEdit === 'number' ? settings.multipliers[multEdit] ?? null : null} onClose={() => setMultEdit(null)}
        onSave={(m: VisitStampMultiplier) => { set({ multipliers: multEdit === 'new' ? [...settings.multipliers, m] : settings.multipliers.map((x, k) => (k === multEdit ? m : x)) }); setMultEdit(null) }} />
      <BonusDialog open={bonusOpen} value={settings.firstVisitBonus} onClose={() => setBonusOpen(false)} onSave={(n) => { set({ firstVisitBonus: n }); setBonusOpen(false) }} />
      <RankDialog open={rankOpen} settings={settings} onClose={() => setRankOpen(false)} onSave={(rankMultipliers) => { set({ rankMultipliers }); setRankOpen(false) }} />
      <StoresDialog open={storesOpen} accounts={accounts.map((a) => ({ id: a.id, name: a.displayName || a.name }))} value={accountIds} onClose={() => setStoresOpen(false)} onSave={(ids) => { setAccountIds(ids); setStoresOpen(false) }} />
      <PinDialog open={pinOpen} staff={staff.filter((s) => s.role !== 'viewer')} busy={pinBusy} error={dialogError || undefined} onClose={() => setPinOpen(false)} onSave={(id, pin) => void savePin(id, pin)} />
      <ReasonDialog open={!!rejecting} title="申請を却下する" description="却下するとカードには足しません。お客さまはもう一度申請できます。" confirmLabel="却下する" busy={!!busy} error={dialogError || undefined}
        onClose={() => setRejecting(null)} onConfirm={(why) => { if (rejecting) void review(rejecting, 'reject', why) }} />
      <ReasonDialog open={!!reversing} title="記録を取り消す" description="スタンプの数を元に戻します。取り消したことも記録に残ります。" confirmLabel="取り消す" busy={!!busy} error={dialogError || undefined}
        onClose={() => setReversing(null)} onConfirm={(why) => { if (reversing) void reverse(reversing, why) }} />
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="保存していないカードの設定" onConfirm={confirmLeave} onCancel={cancelLeave} />
      <PhotoDialog url={photo && /^https:\/\//.test(photo.photo_url) ? photo.photo_url : null} name={photo ? friendNames(friendById(photo.friend_id) ?? { displayName: '友だち' }).name : ''} onClose={() => setPhoto(null)} />
    </PageFrame>
  )
}

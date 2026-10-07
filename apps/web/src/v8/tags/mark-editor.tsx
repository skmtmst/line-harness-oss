'use client'

/*
 * ★V8 対応マークを作る・編集（Pencil `ulq9Y`、保管の小窓は `fy5dz`）。
 *
 * 型（CreatePage）の左に段「基本」（マーク名・色）と段「自動で変えるきまり」、右の列に「出す場所と数」と案内の帯。
 * 下の帯は「保管する」が左端、キャンセル・保存が真ん中。
 * 読み込み・保存・版の衝突（R513）・冪等キー（R512）・権限（R511）・保管の影響確認は
 * 今の部品（app/tags/mark-editor-v8.tsx）から写した。
 * 絵に無い「新しい友だちに最初から付ける」は右の列の下の空きに置く。並び順は一覧で並べ替える（ここでは今の値を保つ）。
 * きまりの中身を変える・作るは、今の自動変更ルールの部品（SupportMarkRulesPanel）を窓で開く。
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, Check, Pencil, Plus, Trash2, Zap } from 'lucide-react'
import {
  api,
  ApiError,
  describeSaveFailure,
  type SaveSupportMarkAutomationRule,
  type SupportMarkArchiveImpact,
  type SupportMarkAutomationEvent,
  type SupportMarkAutomationRule,
  type SupportMarkListItem,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { CreatePage } from '@/components/templates'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useCanManageSupportMark } from '@/components/friend-fields/support-mark-permissions'
import SupportMarkRulesPanel from '@/components/friend-fields/support-mark-rules-panel'
import { EVENT_LABELS, eventLabel, inExecutionOrder } from '@/components/friend-fields/support-mark-rules-view'
import { AttributeKindGuide, DuplicateNameNote, findDuplicateNames } from '@/components/friend-fields/attribute-kind-guide'
import { ArchiveMarkDialog } from '@/components/friend-fields/mark-list'
import styles from './create.module.css'

const COLORS = [
  { value: '#EF4B55', name: '赤' },
  { value: '#B86A00', name: 'オレンジ' },
  { value: '#06C755', name: '緑' },
  { value: '#2563D4', name: '青' },
  { value: '#6B56CF', name: '紫' },
  { value: '#707981', name: 'グレー' },
] as const
const PLACE_LABELS: Record<string, string> = {
  inbox: '受信箱',
  friend_list: '友だち一覧',
  friend_detail: '友だち詳細',
  dashboard: 'ダッシュボード',
  broadcast: '一斉配信',
  automation: 'オートメーション',
}
const PLACE_ROWS: ReadonlyArray<readonly [key: string, label: string]> = [
  ['inbox', '受信箱'],
  ['friend_list', '友だち一覧'],
  ['friend_detail', '友だち詳細'],
]
/* きまりの行の言葉（絵：「担当が決まったら → 対応中にする」）。 */
const WHEN_WORDS: Record<string, string> = {
  message_received: 'メッセージが届いたら',
  manual_reply_sent: '担当者が返信したら',
  staff_assigned: '担当が決まったら',
  response_overdue: '返信の期限を過ぎたら',
  condition_matched: '条件に合ったら',
}
type MarkRow = SupportMarkListItem

/** 配信・シナリオ・自動応答・保存検索・自動化からの参照数（API の canArchive と同じ母数）。 */
function referenceCount(mark: MarkRow): number {
  return (mark.usedIn?.broadcasts ?? 0)
    + (mark.usedIn?.scenarios ?? 0)
    + (mark.usedIn?.autoReplies ?? 0)
    + (mark.usedIn?.savedSearches ?? 0)
    + (mark.usedIn?.automations ?? 0)
}

export default function MarkEditor({ markId }: { markId?: string }) {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <MarkEditorBody markId={markId} />
    </Suspense>
  )
}

function MarkEditorBody({ markId }: { markId?: string }) {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const editing = Boolean(markId)
  usePageTitle(editing ? '対応マークを編集' : '対応マークを作る')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: '友だち属性', href: '/tags' }, { label: '対応マーク', href: '/tags?tab=marks' }])

  const [items, setItems] = useState<MarkRow[]>([])
  /* 一覧の読み込み具合。ready になるまで保存は押せない（R510・R511）。 */
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading')
  const [loadMessage, setLoadMessage] = useState('')
  const [reloading, setReloading] = useState(false)
  const [name, setName] = useState('要確認')
  const [color, setColor] = useState<string>(COLORS[0].value)
  const [displayOrder, setDisplayOrder] = useState(4)
  const [isDefault, setIsDefault] = useState(false)
  /* 作る画面のきまりは「作るだけで有効」にしない。「きまりを作る」を押したときだけ登録する（ATTR-06）。 */
  const [createRule, setCreateRule] = useState(false)
  const [ruleEvent, setRuleEvent] = useState<SupportMarkAutomationEvent>('staff_assigned')
  const [ruleActive, setRuleActive] = useState(true)
  const [ruleProtectionMinutes, setRuleProtectionMinutes] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  /* 保存で権限不足（403）が返ってきた。以後は押させず、理由だけ見せる（R511）。 */
  const [saveForbidden, setSaveForbidden] = useState(false)
  /* 同じ作成のやり直しは同じ要求キー。入力を変えたら新しいキー（R512）。 */
  const idempotencyKeyRef = useRef<{ signature: string; key: string } | null>(null)
  const attemptSignature = JSON.stringify([name, color, displayOrder, isDefault, createRule, ruleEvent, ruleActive, ruleProtectionMinutes])
  function attemptKey(): string {
    const current = idempotencyKeyRef.current
    if (current && current.signature === attemptSignature) return current.key
    const key = crypto.randomUUID()
    idempotencyKeyRef.current = { signature: attemptSignature, key }
    return key
  }
  /* ほかの担当者が先に変えていたときの最新の内容（R513）。 */
  const [conflict, setConflict] = useState<{ name: string; color: string; displayOrder: number; version: number } | null>(null)
  const [baseline, setBaseline] = useState<{ name: string; color: string; displayOrder: number; isDefault: boolean } | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveImpact, setArchiveImpact] = useState<SupportMarkArchiveImpact | null>(null)
  const [replacementMarkId, setReplacementMarkId] = useState('')
  const [impactLoading, setImpactLoading] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  /* 編集のときのきまり（読むだけ。変える・作るは窓の部品）。 */
  const [rules, setRules] = useState<SupportMarkAutomationRule[]>([])
  const [rulesState, setRulesState] = useState<'loading' | 'ready' | 'error' | 'forbidden' | 'not-connected'>('loading')
  const [rulesOpen, setRulesOpen] = useState(false)
  const [stoppingRule, setStoppingRule] = useState<SupportMarkAutomationRule | null>(null)
  const [ruleBusy, setRuleBusy] = useState(false)
  const [ruleError, setRuleError] = useState('')

  const selected = useMemo(() => items.find((mark) => mark.id === markId), [items, markId])
  const dirty = baseline !== null && (
    name !== baseline.name
    || color !== baseline.color
    || displayOrder !== baseline.displayOrder
    || isDefault !== baseline.isDefault
    || (!editing && (createRule || ruleEvent !== 'staff_assigned' || ruleActive !== true || ruleProtectionMinutes !== 0))
  )
  const { leaveTarget, confirmLeave, cancelLeave, guarded, disarm } = useUnsavedGuard({ dirty, busy: saving })
  const nameDuplicates = useMemo(() => findDuplicateNames(items, name, markId ?? null), [items, name, markId])
  const shownTargets = selected?.displayTargets?.length ? selected.displayTargets : ['inbox', 'friend_list', 'friend_detail']
  const archiveBlockReason = !selected ? null
    : selected.isDefault
      ? '初期値のマークは保管できません。先に別のマークを初期値にしてください。'
      : selected.isInherited
        ? '共有しているマークは保管できません。'
        : referenceCount(selected) > 0
          ? '配信や自動化などの使用先があるため保管できません。先に使用先を外してください。'
          : null

  const canManageByRole = useCanManageSupportMark()
  const roleBlocked = canManageByRole === false
  const initialLoadRef = useRef(true)
  /* アカウント切替より前の要求の応答は捨てる（R540）。 */
  const loadSeqRef = useRef(0)
  const loadedAccountRef = useRef<string | null>(null)
  const load = useCallback(async () => {
    const account = selectedAccountId
    if (!account) {
      setItems([])
      setLoadMessage('LINE公式アカウントを選んでください')
      setLoadState('error')
      return
    }
    const seq = ++loadSeqRef.current
    setReloading(true)
    setLoadMessage('')
    try {
      const res = await api.supportMarks.list(account)
      if (loadSeqRef.current !== seq) return
      if (!res.success) throw new Error(res.error)
      const rows = res.data
      loadedAccountRef.current = account
      setItems(rows)
      const current = rows.find((mark) => mark.id === markId)
      if (current) {
        if (initialLoadRef.current) {
          setName(current.name)
          setColor(current.color)
          setDisplayOrder(current.displayOrder)
          setIsDefault(current.isDefault)
        }
        setBaseline({ name: current.name, color: current.color, displayOrder: current.displayOrder, isDefault: current.isDefault })
        setLoadState('ready')
      } else if (editing) {
        setLoadMessage('対応マークが見つかりません。一覧から選び直してください。')
        setLoadState('error')
      } else if (initialLoadRef.current) {
        setDisplayOrder(rows.length)
        setBaseline({ name: '要確認', color: COLORS[0].value, displayOrder: rows.length, isDefault: false })
        setLoadState('ready')
      } else {
        setLoadState('ready')
      }
    } catch (reason) {
      if (loadSeqRef.current !== seq) return
      const status = (reason as { status?: number } | null)?.status
      if (status === 403) {
        setLoadMessage('')
        setLoadState('forbidden')
      } else {
        setLoadMessage('対応マークを読み込めませんでした。入力内容はそのままです。')
        setLoadState('error')
      }
    } finally {
      if (loadSeqRef.current === seq) {
        initialLoadRef.current = false
        setReloading(false)
      }
    }
  }, [editing, markId, selectedAccountId])

  useEffect(() => {
    initialLoadRef.current = true
    setBaseline(null)
    setConflict(null)
    setSaveForbidden(false)
    void load()
  }, [editing, markId, selectedAccountId, load])

  /* 編集のときだけ、きまりを読む。権限・未接続（404）・失敗を分ける。 */
  const loadRules = useCallback(async () => {
    if (!editing || !markId || !selectedAccountId) return
    setRulesState('loading')
    try {
      const res = await api.supportMarks.automationRules(markId, selectedAccountId)
      if (!res.success) throw new Error('failed')
      setRules(inExecutionOrder(res.data))
      setRulesState('ready')
    } catch (reason) {
      if (!(reason instanceof ApiError)) { setRulesState('error'); return }
      setRulesState(reason.status === 403 ? 'forbidden' : reason.status === 404 ? 'not-connected' : 'error')
    }
  }, [editing, markId, selectedAccountId])
  useEffect(() => { void loadRules() }, [loadRules])

  const stopRule = async () => {
    if (!selectedAccountId || !stoppingRule) return
    setRuleBusy(true)
    setRuleError('')
    try {
      const res = await api.supportMarks.archiveAutomationRule(stoppingRule.id, selectedAccountId, stoppingRule.version)
      if (!res.success) throw new Error('failed')
      setStoppingRule(null)
      await loadRules()
    } catch (reason) {
      setRuleError(reason instanceof ApiError && reason.status === 409
        ? 'ほかの担当者が先に変えました。読み直してから、もう一度お試しください。'
        : 'きまりを止められませんでした。もう一度お試しください。')
    } finally {
      setRuleBusy(false)
    }
  }

  const save = async () => {
    if (!name.trim()) return setError('マーク名を入力してください')
    if (!selectedAccountId) return setError('LINE公式アカウントを選んでください')
    if (loadState !== 'ready' || roleBlocked || saveForbidden) return
    if (loadedAccountRef.current !== selectedAccountId) return
    setSaving(true)
    setError('')
    setConflict(null)
    try {
      const result = editing && markId
        ? await api.supportMarks.update(markId, selectedAccountId, {
          name: name.trim(), color, displayOrder, isDefault,
          autoOnInbound: selected?.autoOnInbound ?? false,
          // 読んだときの版を送る。ほかの担当者が先に変えていたら 409 で止める（R513）。
          ...(selected ? { expectedVersion: selected.version } : {}),
        })
        : await api.supportMarks.create(selectedAccountId, {
          name: name.trim(), color, displayOrder, isDefault, autoOnInbound: false,
          automationRules: createRule ? [{ name: `${name.trim()}：${eventLabel(ruleEvent)}`, event: ruleEvent, condition: null, priority: 0, manualProtectionMinutes: ruleProtectionMinutes, isActive: ruleActive } satisfies SaveSupportMarkAutomationRule] : [],
        }, attemptKey())
      if (!result.success) throw new Error(result.error)
      disarm()
      router.push('/tags?tab=marks')
    } catch (reason) {
      const status = (reason as { status?: number } | null)?.status
      const code = (reason as { code?: string } | null)?.code
      if (status === 403) {
        setSaveForbidden(true)
        setError(describeSaveFailure(reason))
        return
      }
      if (status === 409 && code === 'SUPPORT_MARK_VERSION_CONFLICT') {
        const latest = (reason as { data?: { latest?: { name?: string; color?: string; displayOrder?: number; version?: number } } }).data?.latest
        if (latest && typeof latest.name === 'string') {
          const next = {
            name: latest.name,
            color: typeof latest.color === 'string' ? latest.color : color,
            displayOrder: typeof latest.displayOrder === 'number' ? latest.displayOrder : displayOrder,
            version: typeof latest.version === 'number' ? latest.version : (selected?.version ?? 1),
          }
          setConflict(next)
          setItems((prev) => prev.map((mark) => mark.id === markId
            ? { ...mark, name: next.name, color: next.color, displayOrder: next.displayOrder, version: next.version }
            : mark))
          setBaseline({ name: next.name, color: next.color, displayOrder: next.displayOrder, isDefault: selected?.isDefault ?? isDefault })
        }
        setError('ほかの担当者が先に変更しました。最新の内容を確認してから保存し直してください。')
        return
      }
      setError(describeSaveFailure(reason))
    } finally {
      setSaving(false)
    }
  }

  /* 保管：一覧の保管と同じ影響確認を経る。 */
  const openArchive = async () => {
    const account = selectedAccountId
    if (!account || !selected) return
    setArchiveOpen(true)
    setArchiveImpact(null)
    setReplacementMarkId('')
    setArchiveError('')
    setImpactLoading(true)
    try {
      const res = await api.supportMarks.archiveImpact(selected.id, account)
      if (!res.success) throw new Error(res.error)
      setArchiveImpact(res.data)
      setReplacementMarkId(res.data.replacementOptions.find((option) => option.isDefault)?.id ?? res.data.replacementOptions[0]?.id ?? '')
    } catch {
      setArchiveError('保管の影響を確認できませんでした。画面を閉じて、もう一度お試しください。')
    } finally {
      setImpactLoading(false)
    }
  }

  const confirmArchive = async (mark: MarkRow) => {
    const replacement = (archiveImpact?.friendCount ?? 0) > 0 ? replacementMarkId : (replacementMarkId || null)
    if (!selectedAccountId || !archiveImpact || ((archiveImpact.friendCount ?? 0) > 0 && !replacementMarkId) || archiving) return
    setArchiveError('')
    setArchiving(true)
    try {
      const res = await api.supportMarks.archive(mark.id, selectedAccountId, {
        replacementMarkId: replacement,
        impactRevision: archiveImpact.impactRevision,
        expectedVersion: archiveImpact.expectedVersion,
      }, crypto.randomUUID())
      if (!res.success) throw new Error(res.error)
      setArchiveOpen(false)
      setArchiveImpact(null)
      disarm()
      router.push('/tags?tab=marks')
    } catch {
      setArchiveError('対応マークを保管できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setArchiving(false)
    }
  }

  const blockedReason =
    loadState === 'error' ? '一覧を読み込めませんでした。再読み込みしてください'
      : loadState === 'forbidden' ? '対応マークを見る権限がありません'
        : roleBlocked ? '対応マークを作る権限がありません'
          : saveForbidden ? '対応マークを保存する権限がありません'
            : loadState === 'ready' && loadedAccountRef.current !== selectedAccountId ? 'アカウントを切り替えています。一覧を読み込むまでお待ちください'
              : !name.trim() ? 'マーク名を入力すると保存できます'
                : editing && !selected ? '編集中のマークを読み込めませんでした'
                  : null
  const saveDisabled = saving || blockedReason !== null
  const hideForm = loadState === 'forbidden' || roleBlocked

  const applyLatest = () => {
    if (!conflict) return
    setName(conflict.name)
    setColor(conflict.color)
    setDisplayOrder(conflict.displayOrder)
    setConflict(null)
  }

  if (loadState === 'loading') return <ListState kind="loading" />

  const back = <Link href="/tags?tab=marks" className={styles.backLink}>← 対応マークへ</Link>
  const description = editing && selected
    ? `${selected.friendCount}人に付いている・${shownTargets.map((target) => PLACE_LABELS[target]).filter(Boolean).join('・')}に出る`
    : '対応の状態を、色つきの印で管理します。'

  const aside = hideForm ? null : (
    <div className={styles.aside}>
      <h2 className={styles.asideTitle}>出す場所と数</h2>
      <dl className={styles.placeList}>
        <div className={styles.placeRow}><dt>付いている人</dt><dd>{selected ? `${selected.friendCount} 人` : '0 人'}</dd></div>
        {PLACE_ROWS.map(([key, label]) => (
          <div key={key} className={styles.placeRow}><dt>{label}</dt><dd>{shownTargets.includes(key) ? '出す' : '出さない'}</dd></div>
        ))}
      </dl>
      {editing ? (
        <p className={styles.infoNote}>
          <Archive className={styles.wayIcon} aria-hidden="true" />
          保管すると、新しく付けられなくなります。いま付いている人は、保管の小窓で選ぶマークへ置き換わり、履歴に残ります。
        </p>
      ) : null}
      <div className={styles.field}>
        <Checkbox checked={isDefault} disabled={selected?.isDefault} onCheckedChange={setIsDefault}>新しい友だちに最初から付ける</Checkbox>
        <p className={styles.fieldNote}>最初から付けるマークは1つだけ選べます</p>
      </div>
    </div>
  )

  return (
    <>
      <CreatePage
        boardId="ulq9Y"
        title={editing ? (selected?.name ?? '対応マークを編集') : '対応マークを作る'}
        description={description}
        help={<AttributeKindGuide current="mark" />}
        identity={back}
        preview={aside}
        destructive={editing && selected && !hideForm ? (
          <Button type="button" variant="danger" onClick={() => void openArchive()} disabled={archiveBlockReason !== null} title={archiveBlockReason ?? undefined}>
            <Archive size={15} aria-hidden="true" />保管する
          </Button>
        ) : undefined}
        footerActions={hideForm ? <Button href="/tags?tab=marks">一覧へ戻る</Button> : <>
          <Button type="button" onClick={() => guarded(() => router.push('/tags?tab=marks'))}>キャンセル</Button>
          <Button type="button" variant="primary" disabled={saveDisabled} title={blockedReason ?? undefined} onClick={() => void save()} busy={saving}>
            <Check size={15} aria-hidden="true" />{editing ? '保存する' : '対応マークを作る'}
          </Button>
        </>}
      >
        {hideForm ? (
          <ListState
            kind="forbidden"
            description={editing ? '対応マークを編集する権限がありません。オーナーか管理者に確認してください。' : '対応マークを作る権限がありません。オーナーか管理者に確認してください。'}
          />
        ) : null}
        {!hideForm && loadState === 'error' ? (
          <ListState kind="error" title="対応マークを読み込めませんでした" description={loadMessage || '入力内容はそのままです。'} onRetry={() => void load()} retrying={reloading} />
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {conflict ? (
          <Notice tone="warn" action={<Button type="button" onClick={applyLatest}>最新の内容を取り込む</Button>}>
            {`最新の保存内容は名前「${conflict.name}」・並び順${conflict.displayOrder}です。入力内容はそのまま残しています。入力のまま保存し直すか、最新の内容を取り込んでください。`}
          </Notice>
        ) : null}

        {hideForm ? null : (
          <>
            <section className={styles.card} aria-labelledby="mark-basic">
              <div className={styles.cardHead}><h2 className={styles.cardTitle} id="mark-basic">基本</h2></div>
              <label className={styles.field}>
                <span className={styles.label}>マーク名</span>
                <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} placeholder="例：要確認" />
                <DuplicateNameNote duplicates={nameDuplicates} kindLabel="対応マーク" />
              </label>
              <div className={styles.colorField} role="group" aria-labelledby="mark-color">
                <span className={styles.labelStrong} id="mark-color">色</span>
                <span className={styles.colorRow}>
                  {COLORS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setColor(item.value)}
                      aria-label={item.name}
                      title={item.name}
                      aria-pressed={color.toLowerCase() === item.value.toLowerCase()}
                      className={styles.colorSwatch}
                      style={{ backgroundColor: item.value }}
                    />
                  ))}
                </span>
                <p className={styles.keyNote}>赤・オレンジ・緑・青・紫・グレー（色と名前の両方で見分ける）</p>
              </div>
            </section>

            <section className={styles.card} aria-labelledby="mark-rules">
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle} id="mark-rules">自動で変えるきまり</h2>
                <p className={styles.cardNote}>条件に合ったら、このマークに変えます</p>
              </div>
              {editing ? (
                <>
                  {rulesState === 'not-connected' ? <p className={styles.fieldNote}>自動で変えるきまりは、まだこの環境で使えません（準備中）。</p> : null}
                  {rulesState === 'forbidden' ? <p className={styles.fieldNote}>きまりを見る権限がありません。オーナーか管理者に確認してください。</p> : null}
                  {rulesState === 'error' ? (
                    <div className={styles.inlineRetry}>
                      <p className={styles.fieldError} role="alert">きまりを読み込めませんでした。</p>
                      <Button type="button" variant="text" onClick={() => void loadRules()}>読み直す</Button>
                    </div>
                  ) : null}
                  {rulesState === 'ready' && rules.length === 0 ? <p className={styles.fieldNote}>今は自動で変えません。必要なときだけきまりを作ってください。</p> : null}
                  {ruleError ? <p className={styles.fieldError} role="alert">{ruleError}</p> : null}
                  {rules.map((rule) => (
                    <div key={rule.id} className={styles.ruleRow} data-off={rule.isActive ? undefined : ''}>
                      <Zap className={styles.ruleIcon} aria-hidden="true" />
                      <span className={styles.ruleWhen} title={rule.name}>{`${WHEN_WORDS[rule.event] ?? eventLabel(rule.event)}${rule.isActive ? '' : '（止めています）'}`}</span>
                      <span className={styles.ruleThen}>{`→ ${name.trim() || 'このマーク'}にする`}</span>
                      <button type="button" className={styles.iconButton} aria-label={`きまり「${rule.name}」を直す`} title="直す" onClick={() => setRulesOpen(true)}>
                        <Pencil className={styles.wayIcon} aria-hidden="true" />
                      </button>
                      <button type="button" className={styles.iconButton} aria-label={`きまり「${rule.name}」を止める`} title="止める" onClick={() => { setRuleError(''); setStoppingRule(rule) }}>
                        <Trash2 className={styles.wayIcon} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  {rulesState === 'ready' || rulesState === 'loading' ? (
                    <span>
                      <Button type="button" variant="text" onClick={() => setRulesOpen(true)}><Plus size={15} aria-hidden="true" />きまりを作る</Button>
                    </span>
                  ) : null}
                </>
              ) : createRule ? (
                <div className={styles.ruleForm}>
                  <label className={styles.field}>
                    <span className={styles.label}>きっかけ</span>
                    <Select aria-label="きっかけ" value={ruleEvent} onChange={(value) => setRuleEvent(value as SupportMarkAutomationEvent)} options={EVENT_LABELS.map((item) => ({ value: item.value, label: item.label }))} size="full" />
                  </label>
                  <p className={styles.fieldNote}>{`→ 「${name || 'このマーク'}」に変える`}</p>
                  <label className={styles.field}>
                    <span className={styles.label}>手動で変更した直後の保護</span>
                    <Select
                      aria-label="手動変更の保護時間"
                      value={String(ruleProtectionMinutes)}
                      onChange={(value) => setRuleProtectionMinutes(Number(value))}
                      options={[
                        { value: '0', label: '保護しない（次のきっかけですぐ変更）' },
                        { value: '30', label: '30分は手動の変更を守る' },
                        { value: '60', label: '1時間は手動の変更を守る' },
                        { value: '1440', label: '1日は手動の変更を守る' },
                      ]}
                      size="full"
                    />
                  </label>
                  <Checkbox checked={ruleActive} onCheckedChange={setRuleActive}>このきまりを有効にして登録する</Checkbox>
                  <span><Button type="button" onClick={() => setCreateRule(false)}>きまりを外す</Button></span>
                </div>
              ) : (
                <span>
                  <Button type="button" variant="text" onClick={() => setCreateRule(true)}><Plus size={15} aria-hidden="true" />きまりを作る</Button>
                </span>
              )}
            </section>
          </>
        )}
      </CreatePage>

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="マークへの変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
      {archiveOpen && selected ? (
        <ArchiveMarkDialog
          mark={selected}
          impact={archiveImpact}
          replacementMarkId={replacementMarkId}
          loading={impactLoading}
          saving={archiving}
          error={archiveError}
          onReplacement={setReplacementMarkId}
          onCancel={() => { if (!archiving) { setArchiveOpen(false); setArchiveImpact(null) } }}
          onConfirm={() => void confirmArchive(selected)}
        />
      ) : null}
      {/* きまりを作る・直すは今の自動変更ルールの部品を窓で開く。閉じたら読み直す。 */}
      <Dialog open={rulesOpen} size="large" title="自動で変えるきまり" onCancel={() => { setRulesOpen(false); void loadRules() }}>
        {rulesOpen ? <SupportMarkRulesPanel accountId={selectedAccountId} markId={markId ?? null} markName={name} /> : null}
      </Dialog>
      <ConfirmDialog
        open={stoppingRule !== null}
        title={stoppingRule ? `きまり「${stoppingRule.name}」を止めますか？` : 'きまりを止めますか？'}
        description="止めると、このきまりでは自動で変わらなくなります。今付いているマークはそのまま残ります。"
        confirmLabel="止める"
        destructive
        busy={ruleBusy}
        error={ruleError || undefined}
        onCancel={() => { if (!ruleBusy) setStoppingRule(null) }}
        onConfirm={() => void stopRule()}
      />
    </>
  )
}

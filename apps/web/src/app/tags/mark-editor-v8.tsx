'use client'

/*
 * ★V8 対応マークを作る・編集（Pencil `ulq9Y`、保管の小窓は `fy5dz`）。
 *
 * v7（components/friend-fields/support-mark-editor.tsx）と動きは同じで、
 * 置き場だけを V8 の絵へ合わせる。段は「基本」「自動で変えるきまり」。
 * 右の欄に「出す場所と数」。追従バーは「保管する」＝左端、
 * キャンセル・保存＝真ん中（オーナー決定 2026-10-01）。
 * 初期値・共有・使用先ありのマークは「保管する」を押せない形にして理由を出す。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive } from 'lucide-react'
import { api, describeSaveFailure, type SaveSupportMarkAutomationRule, type SupportMarkArchiveImpact, type SupportMarkAutomationEvent, type SupportMarkListItem } from '@/lib/api'
import { useCanManageSupportMark } from '@/components/friend-fields/support-mark-permissions'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import Button from '@/components/shared/button'
import NoPermissionV8 from '@/app/no-permission/no-permission-v8'
import Checkbox from '@/components/shared/checkbox'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Select from '@/components/shared/select'
import ListState from '@/components/shared/list-state'
import { DelayedSkeleton } from '@/components/shared/skeleton'
import { TagFormSkeleton } from './tag-rows-skeleton'
import StickyBar from '@/components/shared/sticky-bar'
import SupportMarkRulesPanel from '@/components/friend-fields/support-mark-rules-panel'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import Notice from '@/components/shared/notice'
import { EVENT_LABELS, eventLabel } from '@/components/friend-fields/support-mark-rules-view'
import { AttributeKindGuide, DuplicateNameNote, findDuplicateNames } from '@/components/friend-fields/attribute-kind-guide'
import { ArchiveMarkDialog } from '@/components/friend-fields/mark-list'
import styles from './mark-editor-v8.module.css'

const COLORS = [
  { value: '#EF4B55', name: '赤' },
  { value: '#B86A00', name: 'オレンジ' },
  { value: '#06C755', name: '緑' },
  { value: '#2563D4', name: '青' },
  { value: '#6B56CF', name: '紫' },
  { value: '#707981', name: 'グレー' },
] as const
/* 板 `ulq9Y` の右の欄「出す場所と数」。出す場所は口が返す displayTargets に合わせる。 */
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
type MarkRow = SupportMarkListItem

/** 配信・シナリオ・自動応答・保存検索・自動化からの参照数（API の canArchive と同じ母数）。 */
function referenceCount(mark: MarkRow): number {
  return (mark.usedIn?.broadcasts ?? 0)
    + (mark.usedIn?.scenarios ?? 0)
    + (mark.usedIn?.autoReplies ?? 0)
    + (mark.usedIn?.savedSearches ?? 0)
    + (mark.usedIn?.automations ?? 0)
}

export default function MarkEditorV8({ markId }: { markId?: string }) {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const editing = Boolean(markId)
  usePageTitle(editing ? '対応マークを編集' : '対応マークを作る')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: '友だち属性', href: '/tags' }, { label: '対応マーク', href: '/tags?tab=marks' }])

  const [items, setItems] = useState<MarkRow[]>([])
  /*
   * R510・R511: 一覧の読み込み具合。`ready` になるまで保存は押せない。
   */
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading')
  const [loadMessage, setLoadMessage] = useState('')
  const [reloading, setReloading] = useState(false)
  const [name, setName] = useState('要確認')
  const [color, setColor] = useState<string>(COLORS[0].value)
  const [displayOrder, setDisplayOrder] = useState(4)
  const [isDefault, setIsDefault] = useState(false)
  /*
    ATTR-06: 自動変更ルールは「作るだけで有効」にしない。
    「＋ ルールを作る」を押したときだけ登録する。
  */
  const [createRule, setCreateRule] = useState(false)
  const [ruleEvent, setRuleEvent] = useState<SupportMarkAutomationEvent>('staff_assigned')
  const [ruleActive, setRuleActive] = useState(true)
  const [ruleProtectionMinutes, setRuleProtectionMinutes] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  /*
   * R511: 保存で権限不足（403）が返ってきた。以後は押させず、
   * 理由だけを見せる。入力内容は残す。
   */
  const [saveForbidden, setSaveForbidden] = useState(false)
  /*
   * R512: 同じ作成のやり直しは同じ要求キーで送る。入力を変えたら
   * 新しいキーにする。保存直前に内容と比べて決める。
   */
  const idempotencyKeyRef = useRef<{ signature: string; key: string } | null>(null)
  const attemptSignature = JSON.stringify([
    name, color, displayOrder, isDefault,
    createRule, ruleEvent, ruleActive, ruleProtectionMinutes,
  ])
  function attemptKey(): string {
    const current = idempotencyKeyRef.current
    if (current && current.signature === attemptSignature) return current.key
    const key = crypto.randomUUID()
    idempotencyKeyRef.current = { signature: attemptSignature, key }
    return key
  }
  /* R513: ほかの担当者が先に変えていたときの最新の内容。 */
  const [conflict, setConflict] = useState<{
    name: string
    color: string
    displayOrder: number
    version: number
  } | null>(null)
  /* R176 監査：読み込んだ姿との差を未保存とし、離れる操作では確認を出す。 */
  const [baseline, setBaseline] = useState<{ name: string; color: string; displayOrder: number; isDefault: boolean } | null>(null)
  /* ★V8: 「保管する」の確認窓（一覧の保管と同じ流れ・小窓の絵は `fy5dz`）。 */
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveImpact, setArchiveImpact] = useState<SupportMarkArchiveImpact | null>(null)
  const [replacementMarkId, setReplacementMarkId] = useState('')
  const [impactLoading, setImpactLoading] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState('')

  const selected = useMemo(() => items.find((mark) => mark.id === markId), [items, markId])
  const dirty = baseline !== null && (
    name !== baseline.name
    || color !== baseline.color
    || displayOrder !== baseline.displayOrder
    || isDefault !== baseline.isDefault
    || (!editing && (createRule || ruleEvent !== 'staff_assigned' || ruleActive !== true || ruleProtectionMinutes !== 0))
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })
  /* IDEA-04: 同名のマークがすでにあるとき、保存する前に知らせる。 */
  const nameDuplicates = useMemo(() => findDuplicateNames(items, name, markId ?? null), [items, name, markId])
  const currentUsages = selected ? [
    selected.friendCount > 0 ? `友だち ${selected.friendCount}人` : null,
    selected.usedIn?.broadcasts ? `配信 ${selected.usedIn.broadcasts}件` : null,
    selected.usedIn?.scenarios ? `シナリオ ${selected.usedIn.scenarios}件` : null,
    selected.usedIn?.autoReplies ? `自動応答 ${selected.usedIn.autoReplies}件` : null,
    selected.usedIn?.savedSearches ? `保存した検索 ${selected.usedIn.savedSearches}件` : null,
    selected.usedIn?.automations ? `オートメーション ${selected.usedIn.automations}件` : null,
  ].filter((value): value is string => Boolean(value)) : []

  /*
   * 初期値・共有・使用先ありは保管できない（API の canArchive と同じ決まり）。
   * 押せるのに小窓で止められる形にはせず、ボタンを押せない形にして理由を出す。
   */
  const archiveBlockReason = !selected ? null
    : selected.isDefault
      ? '初期値のマークは保管できません。先に別のマークを初期値にしてください。'
      : selected.isInherited
        ? '共有しているマークは保管できません。'
        : referenceCount(selected) > 0
          ? '配信や自動化などの使用先があるため保管できません。先に使用先を外してください。'
          : null
  const shownTargets = selected?.displayTargets?.length ? selected.displayTargets : ['inbox', 'friend_list', 'friend_detail']

  /*
   * R511: 役割が分かっているstaffには作成・編集を案内しない。
   */
  const canManageByRole = useCanManageSupportMark()
  const roleBlocked = canManageByRole === false
  const initialLoadRef = useRef(true)
  /* R540: アカウント切替より前の要求の応答は捨てる。 */
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
            // R513: 読んだときの版を送る。ほかの担当者が先に変えていたら409で止める。
            ...(selected ? { expectedVersion: selected.version } : {}),
          })
        : await api.supportMarks.create(selectedAccountId, {
            name: name.trim(), color, displayOrder, isDefault, autoOnInbound: false,
            automationRules: createRule ? [{ name: `${name.trim()}：${eventLabel(ruleEvent)}`, event: ruleEvent, condition: null, priority: 0, manualProtectionMinutes: ruleProtectionMinutes, isActive: ruleActive } satisfies SaveSupportMarkAutomationRule] : [],
          }, attemptKey())
      if (!result.success) throw new Error(result.error)
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
        const latest = (reason as { data?: { latest?: {
          name?: string; color?: string; displayOrder?: number; version?: number; isDefault?: boolean;
        } } }).data?.latest
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

  /* ★V8: 「保管する」＝一覧の保管と同じ影響確認を経る。 */
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

  if (loadState === 'loading') {
    return <DelayedSkeleton loading skeleton={<TagFormSkeleton />} />
  }

  return (
    <div className={styles.board}>
      <div className={styles.head} data-design="Head">
        <div>
          <Link href="/tags?tab=marks" className={styles.backLink}>← 対応マークへ</Link>
          <h2 className={styles.headTitle}>{editing ? (selected?.name ?? '対応マークを編集') : '対応マークを作る'}</h2>
          <p className={styles.headDescription}>
            {editing && selected
              ? `${selected.friendCount}人に付いている・${shownTargets.map((target) => PLACE_LABELS[target]).filter(Boolean).join('・')}に出る`
              : '対応の状態を、色つきの印で管理します。'}
          </p>
        </div>
      </div>

      {hideForm ? (
        <NoPermissionV8
          featureName="対応マーク"
          capabilitiesHref="/staff"
        />
      ) : null}
      {!hideForm && loadState === 'error' ? (
        <div className="mb-4">
          <ListState
            kind="error"
            title="対応マークを読み込めませんでした"
            description={loadMessage || '入力内容はそのままです。'}
            onRetry={() => void load()}
            retrying={reloading}
          />
        </div>
      ) : null}
      {error ? <Notice tone="danger" className="mb-4">{error}</Notice> : null}
      {conflict ? (
        <Notice
          tone="warn"
          className="mb-4"
          action={<Button type="button" onClick={applyLatest}>最新の内容を取り込む</Button>}
        >
          最新の保存内容は名前「{conflict.name}」・並び順{conflict.displayOrder}です。
          入力内容はそのまま残しています。入力のまま保存し直すか、最新の内容を取り込んでください。
        </Notice>
      ) : null}

      {hideForm ? null : (
        <>
          <div className={styles.split} data-design="Body">
            <div className={styles.main} data-design="Left">
              {/* 段：基本 */}
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>基本</h2>
                <div className={styles.sectionBody}>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>マーク名</span>
                    <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} placeholder="例：要確認" />
                    <DuplicateNameNote duplicates={nameDuplicates} kindLabel="対応マーク" />
                  </div>
                  <fieldset className={styles.field} style={{ margin: 0, padding: 0, border: 'none' }}>
                    <legend className={styles.fieldLabel}>色</legend>
                    <div className={styles.colorGrid}>
                      {COLORS.map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => setColor(item.value)}
                          aria-label={item.name}
                          title={item.name}
                          aria-pressed={color === item.value}
                          className={`${styles.colorSwatch} ${color === item.value ? styles.colorSwatchOn : ''}`}
                          style={{ backgroundColor: item.value }}
                        />
                      ))}
                    </div>
                  </fieldset>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>並び順</span>
                    <input type="number" min={0} value={displayOrder} onChange={(event) => setDisplayOrder(Number(event.target.value))} className={styles.inputNarrow} />
                  </div>
                  <div>
                    <Checkbox
                      checked={isDefault}
                      disabled={selected?.isDefault}
                      onCheckedChange={setIsDefault}
                    >新しい友だちに最初から付ける</Checkbox>
                    <p className={styles.fieldHint}>最初から付けるマークは1つだけ選べます</p>
                  </div>
                  <AttributeKindGuide current="mark" />
                </div>
              </section>

              {/* 段：自動で変えるきまり */}
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>自動で変えるきまり</h2>
                <div className={styles.sectionBody}>
                  {editing ? (
                    <SupportMarkRulesPanel accountId={selectedAccountId} markId={markId ?? null} markName={name} />
                  ) : (
                    <>
                      <p className={styles.noteText}>受信・返信・担当割当・期限超過などをきっかけに自動変更できます。</p>
                      {createRule ? (
                        <div className={styles.ruleBox}>
                          <div className={styles.ruleBoxBody}>
                            <div className={styles.field}>
                              <span className={styles.fieldLabel}>きっかけ</span>
                              <Select
                                aria-label="きっかけ"
                                value={ruleEvent}
                                onChange={(value) => setRuleEvent(value as SupportMarkAutomationEvent)}
                                options={EVENT_LABELS.map((item) => ({ value: item.value, label: item.label }))}
                                size="full"
                              />
                            </div>
                            <p aria-hidden="true" className={styles.ruleArrow}>↓</p>
                            <p className={styles.ruleTarget}>「{name || 'このマーク'}」に変更</p>
                            <div className={styles.field}>
                              <span className={styles.fieldLabel}>手動で変更した直後の保護</span>
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
                            </div>
                            <Checkbox
                              checked={ruleActive}
                              onCheckedChange={setRuleActive}
                            >このルールを有効にして登録する</Checkbox>
                            <div>
                              <Button type="button" onClick={() => setCreateRule(false)}>ルールを外す</Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className={styles.sectionHead}>
                          <p className={styles.noteText}>今は自動変更しません。必要なときだけルールを追加してください。</p>
                          <Button type="button" onClick={() => setCreateRule(true)}>＋ ルールを作る</Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>
            </div>

            {/* 右の欄（板 `ulq9Y` の「出す場所と数」＋案内の帯） */}
            <div className={styles.side} data-design="Right">
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>出す場所と数</h2>
                <div className={styles.sectionBody}>
                  <dl className={styles.placeList}>
                    <div className={styles.placeRow}>
                      <dt>付いている人</dt>
                      <dd>{selected ? `${selected.friendCount} 人` : '0 人'}</dd>
                    </div>
                    {PLACE_ROWS.map(([key, label]) => (
                      <div key={key} className={styles.placeRow}>
                        <dt>{label}</dt>
                        <dd>{shownTargets.includes(key) ? '出す' : '出さない'}</dd>
                      </div>
                    ))}
                  </dl>
                  {editing && currentUsages.length > 0 ? <p className={styles.noteText}>使われている所：{currentUsages.join('、')}</p> : null}
                </div>
              </section>

              {editing ? (
                <section className={styles.infoBand}>
                  <Archive size={14} aria-hidden="true" className={styles.infoBandIcon} />
                  <p>
                    保管すると、新しく付けられなくなります。いま付いている人は、保管の小窓で選ぶマークへ置き換わり、履歴に残ります。
                  </p>
                </section>
              ) : null}
            </div>
          </div>

          <StickyBar
            destructive={editing && selected ? (
              <span className={styles.archiveCluster}>
                <button
                  type="button"
                  onClick={() => void openArchive()}
                  disabled={archiveBlockReason !== null}
                  className={styles.archiveButton}
                >
                  <Archive size={15} aria-hidden="true" />
                  保管する
                </button>
                {archiveBlockReason ? <span className={styles.archiveReason}>{archiveBlockReason}</span> : null}
              </span>
            ) : undefined}
            status={blockedReason ?? (editing ? '変更内容を確認して保存してください' : 'マーク名・色・初期値を確認してください')}
            actions={(
              <>
                <Button href="/tags?tab=marks">キャンセル</Button>
                <Button type="button" variant="primary" disabled={saveDisabled} onClick={() => void save()} busy={saving}>{editing ? '保存する' : '対応マークを作る'}</Button>
              </>
            )}
          />
        </>
      )}
      {/* R176 監査：名前・色などの書きかけがある間の離脱確認。 */}
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
    </div>
  )
}

'use client'

/*
 * 運用者へのお知らせを作る（板 `gjUz3`、公開前の確認 `sDXNy`）。
 * V8だけで作る（v7の作成画面は捨てた）。
 */
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef, useState } from 'react'
import { ArrowRight, Eye, Send } from 'lucide-react'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import StickyBar from '@/components/shared/sticky-bar'
import { useAccount } from '@/contexts/account-context'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { ApiError, api, type OperatorRecipientPreview } from '@/lib/api'
import {
  describeApiFailure,
  isForbidden,
  isForbiddenOrRateLimited,
  loadFailureNotice,
} from '@/components/shared/api-error-message'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import {
  DEFAULT_OPERATOR_EVENT_TYPE,
  OPERATOR_EVENT_OPTIONS,
} from '../../operator-event-options'
import type { OperatorNotificationTeam } from '@line-crm/shared'
import styles from './operator-new-v8.module.css'

const THRESHOLD_OPTIONS = [
  { value: 'one', label: '1件でも' },
  { value: 'three', label: '3件たまったら' },
  { value: 'ten', label: '10件たまったら' },
]

const IMPORTANCE_OPTIONS = [
  { value: 'normal', label: 'ふつう' },
  { value: 'important', label: '重要' },
  { value: 'urgent', label: '緊急' },
]

const SCHEDULE_OPTIONS = [
  { value: 'anytime', label: 'いつでも' },
  { value: 'business_hours', label: '営業時間だけ' },
  { value: 'morning_digest', label: '翌朝にまとめる' },
]

const DEDUPE_OPTIONS = [
  { value: '0', label: '重ねず、その都度知らせる' },
  { value: '10', label: '10分のあいだは1回だけ' },
  { value: '30', label: '30分のあいだは1回だけ' },
  { value: '60', label: '1時間のあいだは1回だけ' },
]

/*
 * 宛先の取得失敗時に保存を止める案内。宛先が回復したら
 * この文言だけを解消する目安にする（他の保存・検証文言は消さない）。
 */
const RECIPIENTS_SAVE_GUARD_MESSAGE =
  '受け取る人を読み込めませんでした。上の「もう一度読み込む」で取り直してから保存してください。'

/** NOTIFY-04: ?id= があれば保存ずみのお知らせを開き直して直す。 */
function readConditions(rule: { conditions: Record<string, unknown> }) {
  const conditions = rule.conditions
  return {
    teamId: typeof conditions.teamId === 'string' ? conditions.teamId : '',
    threshold: typeof conditions.threshold === 'string' ? conditions.threshold : 'one',
    importance: typeof conditions.importance === 'string' ? conditions.importance : 'normal',
    recipientIds: Array.isArray(conditions.recipientIds)
      ? conditions.recipientIds.filter((id): id is string => typeof id === 'string')
      : [],
    schedule: typeof conditions.schedule === 'string' ? conditions.schedule : 'anytime',
    dedupeMinutes: typeof conditions.dedupeMinutes === 'number' ? String(conditions.dedupeMinutes) : '10',
    onlyAvailable: conditions.onlyAvailable === true,
  }
}

function importanceLabel(value: string): string {
  return IMPORTANCE_OPTIONS.find((option) => option.value === value)?.label ?? value
}

function eventLabel(value: string): string {
  return OPERATOR_EVENT_OPTIONS.find((option) => option.value === value)?.label ?? value
}

function NewOperatorNotificationV8Inner() {
  const editId = useSearchParams().get('id')
  usePageTitle(editId ? '運用者へのお知らせをなおす' : '運用者へのお知らせを作る')
  usePageCrumbs([
    { label: 'ホーム', href: '/' },
    { label: '設定', href: '/settings' },
    { label: 'LINE通知', href: '/line-notifications' },
  ])
  const router = useRouter()
  const { selectedAccountId } = useAccount()

  /*
   * お知らせの口はすべて `requireRole('owner', 'admin')` で閉じている。
   * staff には閲覧のみの帯を出して保存の押し口を押せない形にする（閉さない）。
   */
  const [canWrite] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())

  const [eventType, setEventType] = useState(DEFAULT_OPERATOR_EVENT_TYPE)
  const [threshold, setThreshold] = useState('one')
  const [importance, setImportance] = useState('normal')
  const [name, setName] = useState('新しい予約が入りました')
  const [recipients, setRecipients] = useState<OperatorRecipientPreview | null>(null)
  const [recipientIds, setRecipientIds] = useState<string[]>([])
  const [teams, setTeams] = useState<OperatorNotificationTeam[]>([])
  const [teamId, setTeamId] = useState('')
  const [teamName, setTeamName] = useState('')
  const [teamError, setTeamError] = useState('')
  const [teamBusy, setTeamBusy] = useState(false)
  const teamGeneration = useRef(0)
  const loadTeams = () => {
    const accountId = selectedAccountId
    const generation = ++teamGeneration.current
    setTeams([])
    if (!accountId) return
    setTeamError('')
    void api.notifications.teams.list(accountId).then(result => {
      if (generation !== teamGeneration.current) return
      if (!result.success) throw new Error(result.error)
      setTeams(result.data)
    }).catch(() => { if (generation === teamGeneration.current) setTeamError('チームを読み込めませんでした。もう一度読み込んでください。') })
  }
  useEffect(() => {
    setTeamId(''); setTeamName(''); loadTeams()
    return () => { teamGeneration.current++ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId])
  const saveTeam = async () => {
    if (!selectedAccountId || teamBusy) return
    const accountId = selectedAccountId
    const generation = teamGeneration.current
    if (!teamName.trim() || recipientIds.length === 0) { setTeamError('チーム名と1人以上のスタッフを選んでください。'); return }
    setTeamBusy(true); setTeamError('')
    try {
      const existing = teams.find(team => team.id === teamId)
      const result = existing
        ? await api.notifications.teams.update(existing.id, { lineAccountId: accountId, name: teamName.trim(), staffIds: recipientIds, expectedVersion: existing.version })
        : await api.notifications.teams.create({ lineAccountId: accountId, name: teamName.trim(), staffIds: recipientIds })
      if (generation !== teamGeneration.current) return
      if (!result.success) throw new Error(result.error)
      setTeams(current => [...current.filter(team => team.id !== result.data.id), result.data])
      setTeamId(result.data.id); setRecipientIds(result.data.staffIds)
    } catch (caught) { if (generation === teamGeneration.current) setTeamError(caught instanceof Error ? caught.message : '保存できませんでした。') }
    finally { setTeamBusy(false) }
  }

  const [schedule, setSchedule] = useState('anytime')
  const [dedupeMinutes, setDedupeMinutes] = useState('10')
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const [emailFallback, setEmailFallback] = useState(true)
  // NOTIFY-04: id付きで開いたときは最初からそのIDを更新先にする。
  // 読み込み失敗のまま新規作成へ落ちると、同じお知らせが増える。
  const [savedRuleId, setSavedRuleId] = useState<string | null>(editId)
  // 開いたときの版。保存のたびに読んだ版を送り、古い版からの上書きを止める。
  const [ruleVersion, setRuleVersion] = useState<number | null>(null)
  const [ruleLoading, setRuleLoading] = useState(Boolean(editId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // 捕まえた宛先の読み込み失敗。読み込み中のままにせず理由と再試行を出す。
  const [recipientsError, setRecipientsError] = useState<unknown>(null)
  /*
   * 未保存の基準。作成時は宛先の自動選択が終わってから掴む（開いた直後
   * の全選択を「変更あり」と数えないため）。なおし時は読み直しの完了後。
   */
  const [baseline, setBaseline] = useState<string | null>(null)
  const autoIdsRef = useRef<string[] | null>(null)
  const sawLoadingRef = useRef(false)
  /* 公開前の確認の窓（板 `sDXNy`）。 */
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)

  // 保存ずみのお知らせを全項目そのまま復元する。一部だけ戻すと、
  // 開いて保存した時点で戻らなかった項目が初期値へ上書きされる。
  useEffect(() => {
    if (!editId || !selectedAccountId) return
    let active = true
    setRuleLoading(true)
    void api.lineNotifications.operatorRules.get(editId, selectedAccountId)
      .then((result) => {
        if (!active) return
        if (!result.success) throw new Error(result.error)
        const rule = result.data
        const saved = readConditions(rule)
        setRuleVersion(typeof rule.version === 'number' ? rule.version : null)
        setName(rule.name)
        setEventType(rule.eventType)
        setThreshold(saved.threshold)
        setImportance(saved.importance)
        setRecipientIds(saved.recipientIds)
        setTeamId(saved.teamId)
        setSchedule(saved.schedule)
        setDedupeMinutes(saved.dedupeMinutes)
        setOnlyAvailable(saved.onlyAvailable)
        setEmailFallback(rule.channels.includes('email'))
        setRuleLoading(false)
      })
      .catch((caught) => {
        if (!active) return
        setRuleLoading(false)
        if (caught instanceof ApiError && caught.status === 403) {
          setError('このLINEアカウントのお知らせを表示する権限がありません。')
        } else if (caught instanceof ApiError && caught.status === 404) {
          setError('お知らせが見つかりません。アカウントが違うか、削除された可能性があります。')
        } else {
          setError('お知らせを読み込めませんでした。時間をおいてもう一度お試しください。')
        }
      })
    return () => { active = false }
  }, [editId, selectedAccountId])

  // 宛先の取り直し。失敗しても読み込み中のままにせず、理由と再試行を出す。
  // 世代で古い応答を捨てる（アカウント切替後の遅い応答で上書きしない）。
  const recipientsGeneration = useRef(0)
  const loadRecipients = () => {
    const accountId = selectedAccountId
    if (!accountId) { setRecipients(null); setRecipientIds([]); return }
    const generation = ++recipientsGeneration.current
    setRecipientsError(null)
    void api.lineNotifications.operatorRules.previewRecipients({
      lineAccountId: accountId,
      channels: ['dashboard', 'line'],
    }).then((result) => {
      if (generation !== recipientsGeneration.current) return
      if (!result.success) throw new Error(result.error)
      setRecipients(result.data)
      setRecipientsError(null)
      // 宛先が回復したら、保存ガード由来の古い文言だけを解消する。
      setError((current) => (current === RECIPIENTS_SAVE_GUARD_MESSAGE ? '' : current))
      // NOTIFY-04: 再開したお知らせの宛先は保存ずみのもの。全選択で
      // 上書きすると、本人だけにしていた設定が全員へ広がる。
      if (!editId && !teamId) {
        const autoIds = result.data.items.map((item) => item.id)
        setRecipientIds(autoIds)
        autoIdsRef.current = autoIds
      }
    }).catch((caught) => {
      if (generation !== recipientsGeneration.current) return
      setRecipients(null)
      setRecipientsError(caught)
    })
  }

  useEffect(() => {
    loadRecipients()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, editId])

  useEffect(() => {
    const selectedTeam = teams.find(team => team.id === teamId)
    if (selectedTeam) { setRecipientIds(selectedTeam.staffIds); setTeamName(selectedTeam.name) }
  }, [teamId, teams])

  const signature = JSON.stringify([name, eventType, threshold, importance, recipientIds, teamId, schedule, dedupeMinutes, onlyAvailable, emailFallback])

  useEffect(() => {
    if (baseline !== null) return
    if (ruleLoading) {
      sawLoadingRef.current = true
      return
    }
    // なおし時：読み直しを見る前の初期値は基準にしない。
    if (editId && !sawLoadingRef.current) return
    // 作成時：宛先の自動選択（または読み込み失敗の確定）を待つ。
    if (!editId && recipients === null && !error && recipientsError === null) return
    if (!editId && autoIdsRef.current !== null) {
      // 読み込み前に触った分も未保存に数えるよう、初期値＋自動選択で基準を作る。
      setBaseline(JSON.stringify(['新しい予約が入りました', DEFAULT_OPERATOR_EVENT_TYPE, 'one', 'normal', autoIdsRef.current, '', 'anytime', '10', false, true]))
      return
    }
    setBaseline(signature)
  }, [baseline, ruleLoading, editId, recipients, error, recipientsError, signature])

  /*
   * 作成・なおし途中の離脱確認。基準から1か所でも変わっていたら、
   * やめる・左メニューで確認窓を出す。公開・保存が終わると一覧へ
   * router.push するので、成功後に警告は出ない。
   */
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({
    dirty: baseline !== null && signature !== baseline,
    busy: saving || publishing,
  })

  const saveDraft = async (): Promise<string | null> => {
    // 読み込み中に保存すると、未復元の項目が初期値で上書きされる。
    if (saving || ruleLoading) return null
    if (!selectedAccountId) {
      setError('LINEアカウントを選択してください。')
      return null
    }
    if (!name.trim()) {
      setError('お知らせの名前を入力してください。')
      return null
    }
    if (recipientIds.length === 0) {
      // 候補0人では選ぶ操作自体ができない。準備と次の画面を案内する。
      if (recipients !== null && recipients.items.length === 0) {
        setError('受け取る人がいません。先にログインユーザーでスタッフ登録とLINE連携を済ませてください。')
      } else {
        setError(recipientsError !== null
          ? RECIPIENTS_SAVE_GUARD_MESSAGE
          : '受け取るスタッフを1人以上選んでください。')
      }
      return null
    }
    setSaving(true)
    setError('')
    try {
      const scheduleLabel = SCHEDULE_OPTIONS.find((option) => option.value === schedule)?.label ?? 'いつでも'
      const payload = {
        name: name.trim(),
        eventType,
        conditions: {
          threshold,
          importance,
          recipientType: teamId ? 'team' : 'staff',
          ...(teamId ? { teamId } : {}),
          recipientIds,
          recipientLabel: `${recipientIds.length}人`,
          message: null,
          schedule,
          scheduleLabel,
          dedupeMinutes: Number(dedupeMinutes),
          onlyAvailable,
          lifecycle: 'draft',
        },
        channels: emailFallback ? ['dashboard', 'line', 'email'] : ['dashboard', 'line'],
      }
      // 開き直さずに版が分からないまま保存すると、ほかの人の編集を消す。
      if (savedRuleId && ruleVersion === null) {
        setError('お知らせの版が分かりません。一覧へ戻って開き直してください。')
        return null
      }
      // 2回目以降は作り直さず書き換える。作り直すと同じお知らせが増える。
      const result = savedRuleId
        ? await api.lineNotifications.operatorRules.updateDraft(savedRuleId, selectedAccountId, {
          expectedVersion: ruleVersion ?? 1, ...payload,
        })
        : await api.lineNotifications.operatorRules.create({ lineAccountId: selectedAccountId, ...payload })
      if (!result.success) throw new Error('save failed')
      setSavedRuleId(result.data.id)
      if (typeof result.data.version === 'number') setRuleVersion(result.data.version)
      setError('')
      return result.data.id
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) {
        setError('このLINEアカウントのお知らせを変更する権限がありません。')
      } else if (caught instanceof ApiError && caught.status === 404) {
        // 一覧から開いたあとに消された等。新規作成へ逃がすと別物が増える。
        setError('お知らせが見つかりません。一覧へ戻って開き直してください。')
      } else if (caught instanceof ApiError && caught.status === 409) {
        // 版の競合はサーバーが開き直しを案内する文を返す。そのまま出す。
        setError(caught.message)
      } else if (caught instanceof ApiError && caught.status === 400) {
        setError(caught.message)
      } else {
        setError('下書きを保存できませんでした。時間をおいてもう一度お試しください。')
      }
      return null
    } finally {
      setSaving(false)
    }
  }

  /*
   * 公開の前に `sDXNy` の確認の窓を出す。保存後に直した分も出すので、
   * 古い内容のまま出さない。選んだスタッフと LINE の届く人数を確かめて
   * から公開する（組③の約束）。
   */
  const openPublishConfirm = async () => {
    if (!selectedAccountId || saving || ruleLoading || publishing) return
    const ruleId = await saveDraft()
    if (!ruleId) return
    setConfirmOpen(true)
  }

  const publish = async () => {
    if (!selectedAccountId || publishing) return
    const ruleId = savedRuleId
    if (!ruleId) return
    setPublishing(true)
    setError('')
    try {
      await api.lineNotifications.operatorRules.publish(ruleId, selectedAccountId)
      router.push(`/line-notifications?tab=operator&highlight=${encodeURIComponent(ruleId)}`)
    } catch (caught) {
      setError(describeApiFailure(caught, '公開', {
        forbidden: 'このLINEアカウントのお知らせを公開する権限がありません。',
      }))
    } finally {
      setPublishing(false)
    }
  }

  const testSend = async () => {
    if (!selectedAccountId || saving || ruleLoading) return
    const ruleId = await saveDraft()
    if (!ruleId) return
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await api.lineNotifications.operatorRules.test(ruleId, selectedAccountId)
      if (!result.success) throw new Error(result.error)
      // 成功は緑の枠で出す。赤い失敗枠には入れない。
      setNotice(result.data.accepted > 0 ? '自分へのテスト送信を受け付けました。' : '受け取れる通知方法がありません。受信設定を確認してください。')
    } catch (caught) {
      setError(describeApiFailure(caught, 'テスト送信', {
        forbidden: 'このLINEアカウントのお知らせをテスト送信する権限がありません。',
      }))
    } finally { setSaving(false) }
  }

  const selectedRecipients = (recipients?.items ?? []).filter((item) => recipientIds.includes(item.id))
  const lineReachable = selectedRecipients.filter((item) => item.channels.line)
  const lineUnregistered = selectedRecipients.length - lineReachable.length
  const saveDisabled = saving || ruleLoading || publishing || !canWrite

  return (
    <div data-design-node="gjUz3" className={styles.board}>
      <div>
        <h1 className={styles.headTitle}>
          運用者へのお知らせを{editId ? 'なおす' : '作る'}
        </h1>
        <p className={styles.headDescription}>
          宛先はお店の人です。あとから顧客向けへは変えられません。顧客へ送るものは「顧客へのお知らせ」で作ります。
        </p>
      </div>

      {canWrite ? null : (
        <div className={styles.roBand} role="status">
          <Eye size={16} aria-hidden="true" />
          <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
        </div>
      )}

      <div className={styles.split}>
        <div className={styles.main}>
          <section className={styles.card} aria-labelledby="operator-when-heading">
            <h2 id="operator-when-heading" className={styles.cardTitle}>どんなときに知らせるか</h2>
            <div className={styles.fieldFull}>
              <label htmlFor="operator-name" className={styles.fieldLabel}>お知らせの名前</label>
              <input
                id="operator-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="新しい予約が入りました"
                maxLength={80}
                className={styles.fieldInput}
              />
            </div>
            <div className={styles.fieldGrid}>
              <div>
                <label htmlFor="operator-event" className={styles.fieldLabel}>きっかけ</label>
                <Select
                  aria-label="きっかけ"
                  id="operator-event"
                  size="full"
                  value={eventType}
                  onChange={(value) => setEventType(value)}
                  options={[...OPERATOR_EVENT_OPTIONS]}
                />
              </div>
              <div>
                <label htmlFor="operator-importance" className={styles.fieldLabel}>重要度</label>
                <Select
                  aria-label="重要度"
                  id="operator-importance"
                  size="full"
                  value={importance}
                  onChange={(value) => setImportance(value)}
                  options={IMPORTANCE_OPTIONS}
                />
              </div>
              <div>
                <label htmlFor="operator-threshold" className={styles.fieldLabel}>どれくらいたまったら</label>
                <Select
                  aria-label="どれくらいたまったら"
                  id="operator-threshold"
                  size="full"
                  value={threshold}
                  onChange={(value) => setThreshold(value)}
                  options={THRESHOLD_OPTIONS}
                />
              </div>
              <div>
                <label htmlFor="operator-dedupe" className={styles.fieldLabel}>同じ知らせを重ねない</label>
                <Select
                  aria-label="同じ知らせを重ねない"
                  id="operator-dedupe"
                  size="full"
                  value={dedupeMinutes}
                  onChange={(value) => setDedupeMinutes(value)}
                  options={DEDUPE_OPTIONS}
                />
              </div>
            </div>
          </section>

          <section className={styles.card} aria-labelledby="operator-who-heading">
            <h2 id="operator-who-heading" className={styles.cardTitle}>だれが受け取るか</h2>
            <p className={styles.cardNote}>LINEログイン済みの人にだけ届きます。お客様の連絡先は宛先に入りません。</p>
            <div className={styles.fieldGrid}>
              <div>
                <label htmlFor="operator-recipient-kind" className={styles.fieldLabel}>送り先</label>
                <Select
                  aria-label="送り先"
                  id="operator-recipient-kind"
                  size="full"
                  value="staff"
                  onChange={() => undefined}
                  options={[{ value: 'staff', label: 'チーム' }]}
                />
              </div>
              <div>
                <label htmlFor="operator-recipient-team" className={styles.fieldLabel}>チーム</label>
                <Select
                  aria-label="チーム"
                  id="operator-recipient-team"
                  size="full"
                  value={teamId}
                  onChange={(value) => {
                    setTeamId(value)
                    const team = teams.find(item => item.id === value)
                    if (team) { setRecipientIds(team.staffIds); setTeamName(team.name) }
                    else setTeamName('')
                  }}
                  options={[{ value: '', label: 'スタッフを選んでチームを作る' }, ...teams.map(team => ({ value: team.id, label: `${team.name}（${team.staffIds.length}人）` }))]}
                />
              </div>
            </div>
            <div className={styles.fieldGrid}>
              <label className={styles.fieldLabel}>チーム名
                <input aria-label="チーム名" value={teamName} maxLength={100} disabled={!canWrite || teamBusy} onChange={event => setTeamName(event.target.value)} className="w-full rounded-control border border-hairline px-3 py-2" />
              </label>
              <Button variant="secondary" disabled={!canWrite || teamBusy} onClick={() => void saveTeam()}>{teamId ? 'チームを更新する' : 'チームを作る'}</Button>
            </div>
            {teamError && <div><p role="alert">{teamError}</p><Button variant="secondary" onClick={loadTeams}>チームをもう一度読み込む</Button></div>}
            <div className={styles.recipientList}>
              {recipients
                // 候補0人では選ぶ操作自体ができない。準備と次の画面を案内する。
                ? (recipients.items.length === 0 ? (
                  <div>
                    <p className={styles.cardTitle} style={{ fontSize: 13 }}>受け取る人がいません</p>
                    <p className={styles.cardNote}>スタッフを登録し、LINE連携が済んだ人が宛先になります。</p>
                    <Link href="/staff" className={styles.linkItem}>ログインユーザーでスタッフを確認する</Link>
                  </div>
                ) : recipients.items.map((recipient) => {
                  const selected = recipientIds.includes(recipient.id)
                  return (
                    <Checkbox
                      key={recipient.id}
                      checked={selected}
                      onCheckedChange={(checked) => { setTeamId(''); setRecipientIds((current) => checked
                        ? [...current, recipient.id]
                        : current.filter((id) => id !== recipient.id)) }}
                    >
                      {recipient.name}{recipient.channels.line ? '' : '（LINE未連携）'}
                    </Checkbox>
                  )
                }))
                : recipientsError !== null
                  ? (
                    <div>
                      <p className={styles.cardNote} role="alert">
                        {isForbiddenOrRateLimited(recipientsError)
                          ? loadFailureNotice(recipientsError, '受け取る人')
                          : '受け取る人を読み込めませんでした。時間をおいて、もう一度お試しください。'}
                      </p>
                      {isForbidden(recipientsError) ? null : (
                        <Button variant="secondary" onClick={() => loadRecipients()}>もう一度読み込む</Button>
                      )}
                    </div>
                  )
                  : <p className={styles.cardNote}>受け取る人を読み込んでいます…</p>}
            </div>
            {recipients && recipients.items.length > 0 ? (
              <p className={styles.recipientSummary}>
                選択 {recipientIds.length}人 ／ LINEで受け取れる {recipients.items.filter((item) => recipientIds.includes(item.id) && item.channels.line).length}人 ／ 管理画面で受け取れる {recipientIds.length}人
              </p>
            ) : null}
            <div className={styles.checkRow}>
              <Checkbox
                checked={onlyAvailable}
                onCheckedChange={setOnlyAvailable}
                description="対応中の人には送りません。"
              >
                手が空いている人だけに送る
              </Checkbox>
              <Checkbox
                checked={emailFallback}
                onCheckedChange={setEmailFallback}
                description="LINE未ログインの人がいるとき"
              >
                だれも受け取れないときはメールでも送る
              </Checkbox>
            </div>
          </section>

          <section className={styles.card} aria-labelledby="operator-when-send-heading">
            <h2 id="operator-when-send-heading" className={styles.cardTitle}>いつ送るか・重ならないか</h2>
            <div className={styles.fieldFull}>
              <label htmlFor="operator-schedule" className={styles.fieldLabel}>送る時間</label>
              <Select
                aria-label="送る時間"
                id="operator-schedule"
                size="full"
                value={schedule}
                onChange={(value) => setSchedule(value)}
                options={SCHEDULE_OPTIONS}
              />
            </div>
            <p className={styles.fieldHint}>営業時間外のものは翌朝10:00にまとめて送ります。</p>
          </section>

          {error ? <p className={styles.formError} role="alert">{error}</p> : null}
          {notice ? <p className={styles.formNotice} role="status">{notice}</p> : null}
        </div>

        <aside className={styles.side} aria-label="公開前の案内">
          <section className={styles.card} aria-labelledby="operator-preview-heading">
            <h2 id="operator-preview-heading" className={styles.cardTitle}>お店の人にはこう届きます</h2>
            <p className={styles.cardNote}>文面はここで確かめられます</p>
            <div className={styles.previewBox}>
              <p className={styles.previewName}>【{importanceLabel(importance)}】{name.trim() || 'お知らせ名'}</p>
              <p className={styles.previewExample}>
                {eventLabel(eventType)}・{dedupeMinutes === '0' ? 'その都度知らせる' : `${dedupeMinutes}分のあいだは1回だけ`}
              </p>
            </div>
            <div className={styles.previewActions}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void testSend()}
                disabled={saveDisabled}
                title={canWrite ? undefined : '閲覧のみのため送れません'}
              >
                <Send size={14} aria-hidden="true" /> 自分にテストを送る
              </Button>
            </div>
          </section>

          <section className={styles.card} aria-labelledby="operator-care-heading">
            <h2 id="operator-care-heading" className={styles.cardTitle}>気をつけること</h2>
            <ul className={styles.warnList}>
              <li>受け取る人が0人だと公開できません</li>
              <li>下書きを保存しても通知は始まりません</li>
              <li>担当が決まっていないと届きません</li>
            </ul>
          </section>

          <section className={styles.card} aria-labelledby="operator-links-heading">
            <h2 id="operator-links-heading" className={styles.cardTitle}>つながる先</h2>
            <div className={styles.linkList}>
              <Link href="/chats" className={styles.linkItem}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <ArrowRight aria-hidden="true" size={13} />受信箱
                </span>
              </Link>
              <Link href="/staff" className={styles.linkItem}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <ArrowRight aria-hidden="true" size={13} />ログインユーザー
                </span>
              </Link>
              <Link href="/line-notifications" className={styles.linkItem}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <ArrowRight aria-hidden="true" size={13} />顧客へのお知らせ
                </span>
              </Link>
            </div>
          </section>
        </aside>
      </div>

      <StickyBar
        status={ruleLoading ? '保存ずみのお知らせを読み込んでいます…' : savedRuleId ? '下書きを保存しました。テスト後に公開できます。' : '下書きです。保存しても通知は始まりません。'}
        actions={(
          <>
            <Button href="/line-notifications?tab=operator" variant="secondary">キャンセル</Button>
            <Button onClick={() => void saveDraft()} disabled={saveDisabled} busy={saving} title={canWrite ? undefined : '閲覧のみのため保存できません'}>
              下書きを保存
            </Button>
            <Button
              onClick={() => void openPublishConfirm()}
              disabled={saveDisabled}
              variant="primary"
              title={canWrite ? undefined : '閲覧のみのため公開できません'}
            >
              ✓ 運用者へのお知らせを公開
            </Button>
          </>
        )}
      />

      {/* 公開前の確認（板 `sDXNy`）。選んだスタッフと LINE の届く人数を確かめる。 */}
      <Dialog
        open={confirmOpen}
        designNode="sDXNy"
        title="このお知らせを公開しますか？"
        onCancel={() => { if (!publishing) setConfirmOpen(false) }}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" onClick={() => setConfirmOpen(false)} disabled={publishing}>
              戻って直す
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void publish()}
              disabled={publishing || selectedRecipients.length === 0}
              busy={publishing}
              busyLabel="公開中…"
            >
              公開して{lineReachable.length}人にLINEで送る
            </Button>
          </div>
        }
      >
        <div>
          <div className={styles.confirmSummary}>
            <div>お知らせ　{name.trim() || 'お知らせ名'}</div>
            <div>宛先　選択中のスタッフ {selectedRecipients.length}人</div>
            <div>LINEが届く人　{lineReachable.length}人{lineUnregistered > 0 ? `（${lineUnregistered}人は LINE 未登録）` : ''}</div>
          </div>
          {selectedRecipients.map((recipient) => (
            <div key={recipient.id} className={styles.confirmRow}>
              <span className={styles.confirmName}>{recipient.name}</span>
              <StatusBadge tone={recipient.channels.line ? 'success' : 'neutral'}>
                {recipient.channels.line ? 'LINE' : '画面だけ'}
              </StatusBadge>
            </div>
          ))}
          <p className={styles.confirmNote}>
            LINE 未登録の人には、管理画面のお知らせだけで届きます。
          </p>
        </div>
      </Dialog>

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力したお知らせ" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}

export default function NewOperatorNotificationV8() {
  return (
    <Suspense>
      <NewOperatorNotificationV8Inner />
    </Suspense>
  )
}

'use client'

/*
 * ★V8 運用者へのお知らせを作る・なおす（板 `gjUz3` 作る・`hiBO8` なおす、公開前の確認 `sDXNy`）。
 *
 * 絵の形：板の頭（題・説明）→ 左に設定の中のメニュー、右に本文。
 * 本文は左に3枚のカード（どんなときに知らせるか・だれが受け取るか・いつ送るか）、
 * 右の列（340）に届き方の見本・気をつけること・つながる先、いちばん下に
 * キャンセル・下書きを保存・公開を真ん中に並べる。
 *
 * データの口・下書き保存・公開・テスト送信・版の守り・未保存の番兵は、今の画面
 * （app/line-notifications/operator/new/operator-new-v8.tsx）から写した。動きは BEHAVIOR.md。
 */
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef, useState } from 'react'
import { Check, Eye, Send } from 'lucide-react'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import StickyBar from '@/components/shared/sticky-bar'
import SettingsInnerNav from '@/components/layout/settings-inner-nav'
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
import { ROLE_LABELS } from '@/lib/hq-members'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import type { OperatorNotificationTeam } from '@line-crm/shared'
import {
  DEDUPE_OPTIONS,
  DEFAULT_EVENT_TYPE,
  EVENT_OPTIONS,
  IMPORTANCE_OPTIONS,
  RECIPIENTS_SAVE_GUARD_MESSAGE,
  SCHEDULE_OPTIONS,
  THRESHOLD_OPTIONS,
  eventLabel,
  eventPlaceLabel,
  importanceLabel,
  readConditions,
} from './operator-words'
import styles from './operator-edit.module.css'

function OperatorEditInner() {
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
   * お知らせの口はすべて owner・admin だけ。staff には閲覧のみの帯を出し、
   * 変える操作のボタンは置かずに隠す（2026-10-06 オーナー決定）。
   */
  const [canWrite] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())

  const [eventType, setEventType] = useState(DEFAULT_EVENT_TYPE)
  const [threshold, setThreshold] = useState('one')
  const [importance, setImportance] = useState('normal')
  const [name, setName] = useState('新しい予約が入りました')
  const [loadedName, setLoadedName] = useState<string | null>(null)
  const [recipients, setRecipients] = useState<OperatorRecipientPreview | null>(null)
  const [recipientIds, setRecipientIds] = useState<string[]>([])
  const [teams, setTeams] = useState<OperatorNotificationTeam[]>([])
  const [teamId, setTeamId] = useState('')
  const [teamName, setTeamName] = useState('')
  const [teamError, setTeamError] = useState('')
  const [teamBusy, setTeamBusy] = useState(false)
  /* 絵に無い「チームを作る」は、受け取るスタッフの箱の右上から開く（足りないときだけ出す）。 */
  const [teamFormOpen, setTeamFormOpen] = useState(false)
  const teamGeneration = useRef(0)
  /*
   * 作るときはチームがあれば最初のチームを選んでおく（絵 gjUz3：送り先「チーム」・チーム「〇〇（3人）」）。
   * 人が宛先・チームを触ったあとや、なおすとき（保存ずみの宛先がある）は選び直さない。
   */
  const teamTouchedRef = useRef(false)
  const teamIdRef = useRef('')
  const autoTeamRef = useRef<OperatorNotificationTeam | null>(null)
  const [teamsSettled, setTeamsSettled] = useState(false)
  const loadTeams = () => {
    const accountId = selectedAccountId
    const generation = ++teamGeneration.current
    setTeams([])
    setTeamsSettled(false)
    if (!accountId) { setTeamsSettled(true); return }
    setTeamError('')
    void api.notifications.teams.list(accountId).then(result => {
      if (generation !== teamGeneration.current) return
      if (!result.success) throw new Error(result.error)
      setTeams(result.data)
      const first = result.data[0]
      if (!editId && first && !teamTouchedRef.current && !teamIdRef.current) {
        autoTeamRef.current = first
        teamIdRef.current = first.id
        setTeamId(first.id)
      }
      setTeamsSettled(true)
    }).catch(() => {
      if (generation !== teamGeneration.current) return
      setTeamError('チームを読み込めませんでした。もう一度読み込んでください。')
      setTeamsSettled(true)
    })
  }
  useEffect(() => {
    setTeamId(''); teamIdRef.current = ''; autoTeamRef.current = null; setTeamName(''); loadTeams()
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
      teamIdRef.current = result.data.id
      setTeamId(result.data.id); setRecipientIds(result.data.staffIds)
    } catch (caught) { if (generation === teamGeneration.current) setTeamError(caught instanceof Error ? caught.message : '保存できませんでした。') }
    finally { setTeamBusy(false) }
  }

  const [schedule, setSchedule] = useState('anytime')
  const [dedupeMinutes, setDedupeMinutes] = useState('10')
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const [emailFallback, setEmailFallback] = useState(true)
  // id付きで開いたときは最初からそのIDを更新先にする。読み込み失敗のまま新規作成へ落ちると、同じお知らせが増える。
  const [savedRuleId, setSavedRuleId] = useState<string | null>(editId)
  // 開いたときの版。保存のたびに読んだ版を送り、古い版からの上書きを止める。
  const [ruleVersion, setRuleVersion] = useState<number | null>(null)
  const [ruleLoading, setRuleLoading] = useState(Boolean(editId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [recipientsError, setRecipientsError] = useState<unknown>(null)
  /* 未保存の基準。作成時は宛先の自動選択が終わってから、なおし時は読み直しの完了後に掴む。 */
  const [baseline, setBaseline] = useState<string | null>(null)
  const autoIdsRef = useRef<string[] | null>(null)
  const sawLoadingRef = useRef(false)
  /* 公開前の確認の窓（板 `sDXNy`）。 */
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  /* 確認の窓の「役割」の列。宛先の口は役割を返さないので、ログインユーザーの一覧から引く。読めなければ空のまま。 */
  const [staffRoles, setStaffRoles] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!confirmOpen) return
    let active = true
    void Promise.resolve().then(() => api.staff.list()).then((result) => {
      if (!active || !result.success) return
      setStaffRoles(Object.fromEntries(result.data.map((member) => [member.id, ROLE_LABELS[member.role] ?? ''])))
    }).catch(() => undefined)
    return () => { active = false }
  }, [confirmOpen])
  const [preparingPublish, setPreparingPublish] = useState(false)

  // 保存ずみのお知らせを全項目そのまま復元する。一部だけ戻すと、保存した時点で初期値へ上書きされる。
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
        setLoadedName(rule.name)
        setEventType(rule.eventType)
        setThreshold(saved.threshold)
        setImportance(saved.importance)
        setRecipientIds(saved.recipientIds)
        teamIdRef.current = saved.teamId
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

  // 宛先の取り直し。失敗しても読み込み中のままにせず、理由と再試行を出す。世代で古い応答を捨てる。
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
      setError((current) => (current === RECIPIENTS_SAVE_GUARD_MESSAGE ? '' : current))
      // 再開したお知らせの宛先は保存ずみのもの。全選択で上書きすると、本人だけにしていた設定が全員へ広がる。
      if (!editId) {
        const autoIds = result.data.items.map((item) => item.id)
        // チームを選んでいるときは、チームの顔ぶれを全員選びで上書きしない。
        if (!teamIdRef.current) setRecipientIds(autoIds)
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
    if (editId && !sawLoadingRef.current) return
    if (!editId && recipients === null && !error && recipientsError === null) return
    // 作るときは最初のチームを選ぶかどうかが決まってから基準を掴む。
    if (!editId && !teamsSettled) return
    if (!editId && autoIdsRef.current !== null) {
      const autoTeam = autoTeamRef.current
      setBaseline(JSON.stringify(['新しい予約が入りました', DEFAULT_EVENT_TYPE, 'one', 'normal', autoTeam ? autoTeam.staffIds : autoIdsRef.current, autoTeam ? autoTeam.id : '', 'anytime', '10', false, true]))
      return
    }
    setBaseline(signature)
  }, [baseline, ruleLoading, editId, recipients, error, recipientsError, signature, teamsSettled])

  /* 作成・なおし途中の離脱確認。公開・保存が終わると一覧へ移るので、成功後に警告は出ない。 */
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
        setError('お知らせが見つかりません。一覧へ戻って開き直してください。')
      } else if (caught instanceof ApiError && (caught.status === 409 || caught.status === 400)) {
        setError(caught.message)
      } else {
        setError('下書きを保存できませんでした。時間をおいてもう一度お試しください。')
      }
      return null
    } finally {
      setSaving(false)
    }
  }

  /* 公開の前に `sDXNy` の確認の窓を出す。保存後に直した分も出すので、古い内容のまま出さない。 */
  const openPublishConfirm = async () => {
    if (!selectedAccountId || saving || ruleLoading || publishing) return
    /* 押した「公開」のボタンに手応え（押せない形＋輪）を出す。先に下書きを保存している間も。 */
    setPreparingPublish(true)
    try {
      const ruleId = await saveDraft()
      if (!ruleId) return
      setConfirmOpen(true)
    } finally {
      setPreparingPublish(false)
    }
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
      setNotice(result.data.accepted > 0 ? '自分へのテスト送信を受け付けました。' : '受け取れる通知方法がありません。受信設定を確認してください。')
    } catch (caught) {
      setError(describeApiFailure(caught, 'テスト送信', {
        forbidden: 'このLINEアカウントのお知らせをテスト送信する権限がありません。',
      }))
    } finally { setSaving(false) }
  }

  const items = recipients?.items ?? []
  const selectedRecipients = items.filter((item) => recipientIds.includes(item.id))
  const lineReachable = selectedRecipients.filter((item) => item.channels.line)
  const lineUnregistered = selectedRecipients.length - lineReachable.length
  const selectedTeam = teamId ? teams.find((team) => team.id === teamId) ?? null : null
  const saveDisabled = saving || ruleLoading || publishing
  const title = editId
    ? `「${loadedName ?? (ruleLoading ? '…' : name.trim() || 'お知らせ')}」を編集する`
    : '運用者へのお知らせを作る'
  const description = editId
    ? '宛先はお店のスタッフ（運用者）です。どんなときに知らせるか・だれが受け取るか・いつ送るかを決めます。閉じるときに保存していなければ確認が出ます。'
    : '宛先はお店の人です。あとから顧客向けへは変えられません。顧客へ送るものは「顧客へのお知らせ」で作ります。'
  const teamOptions = [{ value: '', label: 'スタッフを選ぶ' }, ...teams.map(team => ({ value: team.id, label: `${team.name}（${team.staffIds.length}人）` }))]

  return (
    <div data-design-node={editId ? 'hiBO8' : 'gjUz3'} className={styles.board}>
      <div className={styles.head}>
        <h1 className={styles.headTitle}>{title}</h1>
        <p className={styles.headDescription}>{description}</p>
      </div>

      <div className={styles.body}>
        <SettingsInnerNav inline />
        <div className={styles.content}>
          {canWrite ? null : (
            <div className={styles.roBand} role="status">
              <Eye size={14} aria-hidden="true" />
              <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
            </div>
          )}
          <div className={styles.split}>
            <div className={styles.main}>
              <section className={styles.card} aria-labelledby="operator-when-heading">
                <div className={styles.cardHead}>
                  <h2 id="operator-when-heading" className={styles.cardTitle}>どんなときに知らせるか</h2>
                </div>
                <div className={styles.nameField}>
                  <label htmlFor="operator-name" className={styles.nameLabel}>お知らせの名前</label>
                  <input
                    id="operator-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="新しい予約が入りました"
                    maxLength={80}
                    readOnly={!canWrite}
                    className={styles.input}
                  />
                </div>
                <div className={styles.pair}>
                  <Field id="operator-event" label="きっかけ" value={eventType} onChange={setEventType} options={[...EVENT_OPTIONS]} readOnly={!canWrite} />
                  <Field id="operator-importance" label="重要度" value={importance} onChange={setImportance} options={IMPORTANCE_OPTIONS} readOnly={!canWrite} />
                </div>
                <div className={styles.pair}>
                  <Field id="operator-threshold" label="どれくらいたまったら" value={threshold} onChange={setThreshold} options={THRESHOLD_OPTIONS} readOnly={!canWrite} />
                  <Field id="operator-dedupe" label="同じ知らせを重ねない" value={dedupeMinutes} onChange={setDedupeMinutes} options={DEDUPE_OPTIONS} readOnly={!canWrite} />
                </div>
              </section>

              <section className={styles.card} aria-labelledby="operator-who-heading">
                <div className={styles.cardHead}>
                  <h2 id="operator-who-heading" className={styles.cardTitle}>だれが受け取るか</h2>
                  <p className={styles.cardNote}>LINEログイン済みの人にだけ届きます。お客様の連絡先は宛先に入りません。</p>
                </div>
                <div className={styles.pair}>
                  <Field id="operator-recipient-kind" label="送り先" value="staff" onChange={() => undefined} options={[{ value: 'staff', label: 'チーム' }]} readOnly={!canWrite} />
                  <Field
                    id="operator-recipient-team"
                    label="チーム"
                    value={teamId}
                    readOnly={!canWrite}
                    onChange={(value) => {
                      teamTouchedRef.current = true
                      teamIdRef.current = value
                      setTeamId(value)
                      const team = teams.find(item => item.id === value)
                      if (team) { setRecipientIds(team.staffIds); setTeamName(team.name) }
                      else setTeamName('')
                    }}
                    options={teamOptions}
                  />
                </div>
                {/* 絵 gjUz3：チームを選んでいるときはスタッフの箱を出さない（顔ぶれはチームのとおり）。 */}
                {teamId ? (teamError ? (
                  <div className={styles.teamError}>
                    <p role="alert">{teamError}</p>
                    <Button variant="secondary" onClick={loadTeams}>チームをもう一度読み込む</Button>
                  </div>
                ) : null) : (
                <div className={styles.staffBox}>
                  <div className={styles.staffHead}>
                    <h3 className={styles.staffTitle}>受け取るスタッフ</h3>
                    {canWrite && items.length > 0 && !teamFormOpen ? (
                      <button type="button" className={styles.textButton} onClick={() => setTeamFormOpen(true)}>
                        {teamId ? 'チームを更新する…' : 'この顔ぶれをチームにする…'}
                      </button>
                    ) : null}
                  </div>
                  {recipients
                    ? (items.length === 0 ? (
                      <div className={styles.emptyRecipients}>
                        <p className={styles.emptyTitle}>受け取る人がいません</p>
                        <p className={styles.cardNote}>スタッフを登録し、LINE連携が済んだ人が宛先になります。</p>
                        <Link href="/staff" className={styles.linkItem}>ログインユーザーでスタッフを確認する</Link>
                      </div>
                    ) : (
                      <ul className={styles.staffList}>
                        {/* 閲覧のみ：選ぶチェックは置かず、受け取る人の名前だけを並べる（2026-10-06 オーナー決定）。 */}
                        {(canWrite ? items : items.filter((recipient) => recipientIds.includes(recipient.id))).map((recipient) => (
                          <li key={recipient.id} className={styles.staffRow}>
                            {canWrite ? (
                              <Checkbox
                                checked={recipientIds.includes(recipient.id)}
                                onCheckedChange={(checked) => {
                                  teamTouchedRef.current = true
                                  teamIdRef.current = ''
                                  setTeamId('')
                                  setRecipientIds((current) => checked
                                    ? [...current, recipient.id]
                                    : current.filter((id) => id !== recipient.id))
                                }}
                              >
                                {recipient.name}
                              </Checkbox>
                            ) : <span>{recipient.name}</span>}
                            <span className={styles.staffSpacer} />
                            <StatusBadge tone={recipient.channels.line ? 'success' : 'neutral'}>
                              {recipient.channels.line ? 'LINE' : 'LINE 未ログイン'}
                            </StatusBadge>
                            <StatusBadge tone={recipient.channels.dashboard ? 'success' : 'neutral'}>管理画面</StatusBadge>
                          </li>
                        ))}
                      </ul>
                    ))
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
                  {items.length > 0 ? (
                    <>
                      <p className={styles.staffSummary}>
                        {`選択 ${recipientIds.length}人／LINEで受け取れる ${lineReachable.length}人／管理画面で受け取れる ${recipientIds.length}人`}
                      </p>
                      <p className={styles.staffNote}>0人のときは「受け取る人を1人以上選んでください」と出て、公開できません。</p>
                    </>
                  ) : null}
                  {canWrite && teamFormOpen ? (
                    <div className={styles.teamForm}>
                      <input aria-label="チーム名" placeholder="チーム名" value={teamName} maxLength={100} disabled={teamBusy} onChange={event => setTeamName(event.target.value)} className={styles.input} />
                      <Button variant="secondary" disabled={teamBusy} onClick={() => void saveTeam()}>{teamId ? 'チームを更新する' : 'チームを作る'}</Button>
                    </div>
                  ) : null}
                  {teamError ? (
                    <div className={styles.teamError}>
                      <p role="alert">{teamError}</p>
                      <Button variant="secondary" onClick={loadTeams}>チームをもう一度読み込む</Button>
                    </div>
                  ) : null}
                </div>
                )}
                {canWrite ? <>
                  <Checkbox checked={onlyAvailable} onCheckedChange={setOnlyAvailable}>
                    手が空いている人だけに送る（対応中の人には送りません）
                  </Checkbox>
                  <Checkbox checked={emailFallback} onCheckedChange={setEmailFallback}>
                    だれも受け取れないときはメールでも送る（LINE未ログインの人がいるとき）
                  </Checkbox>
                </> : <>
                  {/* 閲覧のみ：チェックは置かず、いまの設定を文字で見せる。 */}
                  <p className={styles.cardNote}>{`手が空いている人だけに送る：${onlyAvailable ? 'する' : 'しない'}`}</p>
                  <p className={styles.cardNote}>{`だれも受け取れないときはメールでも送る：${emailFallback ? 'する' : 'しない'}`}</p>
                </>}
              </section>

              <section className={styles.card} aria-labelledby="operator-when-send-heading">
                <div className={styles.cardHead}>
                  <h2 id="operator-when-send-heading" className={styles.cardTitle}>いつ送るか・重ならないか</h2>
                </div>
                <Field id="operator-schedule" label="送る時間" value={schedule} onChange={setSchedule} options={SCHEDULE_OPTIONS} readOnly={!canWrite} />
                <p className={styles.cardNote}>営業時間外のものは翌朝 10:00 にまとめて送ります。</p>
              </section>

              {error ? <p className={styles.formError} role="alert">{error}</p> : null}
              {notice ? <p className={styles.formNotice} role="status">{notice}</p> : null}
            </div>

            <aside className={styles.side} aria-label="公開前の案内">
              <section className={styles.card} aria-labelledby="operator-preview-heading">
                <div className={styles.cardHead}>
                  <h2 id="operator-preview-heading" className={styles.cardTitle}>お店の人にはこう届きます</h2>
                  <p className={styles.cardNote}>文面はここで確かめられます</p>
                </div>
                <div className={styles.previewBack}>
                  <div className={styles.previewBubble}>
                    <p className={styles.previewName}>【{importanceLabel(importance)}】{name.trim() || 'お知らせ名'}</p>
                    <p className={styles.previewBody}>
                      {eventLabel(eventType)}・{dedupeMinutes === '0' ? 'その都度知らせる' : `${dedupeMinutes}分のあいだは1回だけ`}
                    </p>
                    <p className={styles.previewBody}>{`${eventPlaceLabel(eventType)}で見る ›`}</p>
                  </div>
                </div>
                {canWrite ? (
                  <Button type="button" variant="secondary" className={styles.wideButton} onClick={() => void testSend()} disabled={saveDisabled}>
                    <Send size={15} aria-hidden="true" />自分にテストを送る
                  </Button>
                ) : null}
              </section>

              <section className={styles.card} aria-labelledby="operator-care-heading">
                <div className={styles.cardHead}>
                  <h2 id="operator-care-heading" className={styles.cardTitle}>気をつけること</h2>
                </div>
                <ul className={styles.careList}>
                  <li>・受け取る人が0人だと公開できません</li>
                  <li>・下書きを保存しても通知は始まりません</li>
                  <li>・担当が決まっていないと届きません</li>
                </ul>
              </section>

              <section className={styles.card} aria-labelledby="operator-links-heading">
                <div className={styles.cardHead}>
                  <h2 id="operator-links-heading" className={styles.cardTitle}>つながる先</h2>
                </div>
                <p className={styles.linkRow}>
                  <Link href="/chats" className={styles.linkItem}>→ 受信箱</Link>
                  <Link href="/staff" className={styles.linkItem}>→ ログインユーザー</Link>
                  <Link href="/line-notifications" className={styles.linkItem}>→ 顧客へのお知らせ</Link>
                </p>
              </section>
            </aside>
          </div>

          <StickyBar
            actions={(
              <>
                <Button href="/line-notifications?tab=operator" variant="secondary">キャンセル</Button>
                {canWrite ? (
                  <>
                    <Button onClick={() => void saveDraft()} disabled={saveDisabled} busy={saving && !preparingPublish}>{editId ? '下書きを保存する' : '下書きを保存'}</Button>
                    <Button onClick={() => void openPublishConfirm()} disabled={saveDisabled} busy={preparingPublish} variant="primary">
                      <Check size={15} aria-hidden="true" />運用者へのお知らせを公開
                    </Button>
                  </>
                ) : null}
              </>
            )}
          />
        </div>
      </div>

      {/* 公開前の確認（板 `sDXNy`）。選んだスタッフと LINE の届く人数を確かめる。 */}
      <Dialog
        open={confirmOpen}
        busy={publishing}
        designNode="sDXNy"
        // 絵 sDXNy：窓の余白24・題の行36・本文までの間14
        designWidth={580}
        designTop={220}
        designHeaderPadding="24px 24px 0"
        designHeaderHeight={50}
        title="このお知らせを公開しますか？"
        onCancel={() => { if (!publishing) setConfirmOpen(false) }}
      >
        <div className={styles.confirmBody}>
          <div className={styles.confirmSummary}>
            <p className={styles.confirmLine}>
              <span className={styles.confirmLabel}>お知らせ</span>
              <span className={styles.confirmValue}>{name.trim() || 'お知らせ名'}</span>
            </p>
            <p className={styles.confirmLine}>
              <span className={styles.confirmLabel}>宛先</span>
              <span className={styles.confirmValue}>
                {selectedTeam
                  ? `チーム「${selectedTeam.name}」${selectedRecipients.length} 人`
                  : `選んだスタッフ ${selectedRecipients.length} 人`}
              </span>
            </p>
            <p className={styles.confirmLine}>
              <span className={styles.confirmLabel}>LINE が届く人</span>
              <span className={styles.confirmValue}>
                {`${lineReachable.length} 人${lineUnregistered > 0 ? `（${lineUnregistered} 人は LINE 未登録）` : ''}`}
              </span>
            </p>
          </div>
          <ul className={styles.confirmList} aria-label="受け取る人">
            {selectedRecipients.map((recipient) => (
              <li key={recipient.id} className={styles.confirmRow}>
                <span className={styles.confirmName} title={recipient.name}>{recipient.name}</span>
                <span className={styles.confirmRole}>{recipientRole(recipient, staffRoles)}</span>
                <StatusBadge tone={recipient.channels.line ? 'success' : 'neutral'}>
                  {recipient.channels.line ? 'LINE' : '画面だけ'}
                </StatusBadge>
              </li>
            ))}
          </ul>
          <p className={styles.confirmNote}>LINE 未登録の人には、管理画面のお知らせだけで届きます。</p>
          <div className={styles.confirmActions}>
            <Button type="button" onClick={() => setConfirmOpen(false)} disabled={publishing}>戻って直す</Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void publish()}
              disabled={publishing || selectedRecipients.length === 0}
              busy={publishing}
              busyLabel="公開中…"
            >
              <Send size={15} aria-hidden="true" />{`公開して ${lineReachable.length} 人に LINE で送る`}
            </Button>
          </div>
        </div>
      </Dialog>

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力したお知らせ" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}

/** 宛先の役割。口が役割を返せばそれを、無ければログインユーザーの一覧から引いた名前を出す。 */
function recipientRole(recipient: OperatorRecipientPreview['items'][number], staffRoles: Record<string, string>): string {
  const own = (recipient as { roleLabel?: unknown }).roleLabel
  return typeof own === 'string' && own ? own : staffRoles[recipient.id] ?? ''
}

/** 題（12px・太字）＋選ぶ欄。2つ並べるときは .pair に入れる。 */
/** 選ぶ欄。閲覧のみ（readOnly）は選ぶ部品を置かず、選んでいる値を読み取りだけの欄で見せる（2026-10-06 オーナー決定）。 */
function Field({ id, label, value, onChange, options, readOnly = false }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  readOnly?: boolean
}) {
  const shown = options.find((option) => option.value === value)?.label ?? value
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>{label}</label>
      {readOnly
        ? <input id={id} aria-label={label} value={shown} readOnly aria-readonly="true" title={shown} className={styles.input} />
        : <Select aria-label={label} id={id} size="full" value={value} onChange={onChange} options={options} />}
    </div>
  )
}

export default function OperatorEditV8() {
  return (
    <Suspense>
      <OperatorEditInner />
    </Suspense>
  )
}

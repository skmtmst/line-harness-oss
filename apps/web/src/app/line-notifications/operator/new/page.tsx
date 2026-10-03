'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef, useState } from 'react'
import { ArrowRight, Building2, Send } from 'lucide-react'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Chip from '@/components/shared/chip'
import Dialog from '@/components/shared/dialog'
import { Field, TextInput } from '@/components/shared/form-controls'
import NoteBar from '@/components/shared/note-bar'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import StickyBar from '@/components/shared/sticky-bar'
import { useAccount } from '@/contexts/account-context'
import { ApiError, api, type OperatorRecipientPreview } from '@/lib/api'
import {
  describeApiFailure,
  isForbidden,
  isForbiddenOrRateLimited,
  loadFailureNotice,
} from '@/components/shared/api-error-message'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAdminTheme } from '@/lib/use-admin-theme'
import NewOperatorNotificationV8 from './operator-new-v8'
import {
  DEFAULT_OPERATOR_EVENT_TYPE,
  OPERATOR_EVENT_OPTIONS,
} from '../../operator-event-options'

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

/**
 * M032追加残差: 宛先の取得失敗時に保存を止める案内。宛先が回復したら
 * この文言だけを解消する目安にする（他の保存・検証文言は消さない）。
 */
const RECIPIENTS_SAVE_GUARD_MESSAGE =
  '受け取る人を読み込めませんでした。上の「もう一度読み込む」で取り直してから保存してください。'

/** NOTIFY-04: ?id= があれば保存ずみのお知らせを開き直して直す。 */
function readConditions(rule: { conditions: Record<string, unknown> }) {
  const conditions = rule.conditions
  return {
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

function NewOperatorNotificationInner() {
  const editId = useSearchParams().get('id')
  usePageTitle(editId ? '運用者へのお知らせをなおす' : '運用者へのお知らせをつくる')
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [eventType, setEventType] = useState(DEFAULT_OPERATOR_EVENT_TYPE)
  const [threshold, setThreshold] = useState('one')
  const [importance, setImportance] = useState('normal')
  const [name, setName] = useState('新しい予約が入りました')
  const [recipients, setRecipients] = useState<OperatorRecipientPreview | null>(null)
  const [recipientIds, setRecipientIds] = useState<string[]>([])
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
  // M032: 捕まえた宛先の読み込み失敗。読み込み中のままにせず理由と再試行を出す。
  const [recipientsError, setRecipientsError] = useState<unknown>(null)
  /*
   * 未保存の基準。作成時は宛先の自動選択が終わってから掴む（開いた直後
   * の全選択を「変更あり」と数えないため）。なおし時は読み直しの完了後。
   */
  const [baseline, setBaseline] = useState<string | null>(null)
  const autoIdsRef = useRef<string[] | null>(null)
  const sawLoadingRef = useRef(false)

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

  // M032: 宛先の取り直し。失敗しても読み込み中のままにせず、理由と再試行を出す。
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
      // M032追加残差: 宛先が回復したら、保存ガード由来の古い文言だけを
      // 解消する。他の保存・公開・テスト送信・検証文言は消さない。
      setError((current) => (current === RECIPIENTS_SAVE_GUARD_MESSAGE ? '' : current))
      // NOTIFY-04: 再開したお知らせの宛先は保存ずみのもの。全選択で
      // 上書きすると、本人だけにしていた設定が全員へ広がる。
      if (!editId) {
        const autoIds = result.data.items.map((item) => item.id)
        setRecipientIds(autoIds)
        autoIdsRef.current = autoIds
      }
    }).catch((caught) => {
      if (generation !== recipientsGeneration.current) return
      setRecipients(null)
      // M032: 宛先の場所で理由と再試行を出す。下の帯には出さない。
      // 生の `API error: NNN` は出さない。
      setRecipientsError(caught)
    })
  }

  useEffect(() => {
    loadRecipients()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, editId])

  const signature = JSON.stringify([name, eventType, threshold, importance, recipientIds, schedule, dedupeMinutes, onlyAvailable, emailFallback])

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
      setBaseline(JSON.stringify(['新しい予約が入りました', DEFAULT_OPERATOR_EVENT_TYPE, 'one', 'normal', autoIdsRef.current, 'anytime', '10', false, true]))
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
    busy: saving,
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
      // R612: 候補0人では選ぶ操作自体ができない。準備と次の画面を案内する。
      if (recipients !== null && recipients.items.length === 0) {
        setError('受け取る人がいません。先にログインユーザーでスタッフ登録とLINE連携を済ませてください。')
      } else {
        /*
         * M032残差: 受取人の取得に失敗したまま保存すると、選択要求の文が
         * 取得失敗の文を置き換えていた。保存自体は止めたまま、取り直しへ
         * 案内する文にする。
         */
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
          recipientType: 'team',
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

  // 板 `sDXNy`「このお知らせを公開しますか？」。保存してから中身を見て決める。
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [publishRuleId, setPublishRuleId] = useState<string | null>(null)
  const [publishError, setPublishError] = useState('')

  const publish = async () => {
    if (!selectedAccountId || saving || ruleLoading) return
    // 保存後に直した分も出す。古い内容のまま出さない。
    const ruleId = await saveDraft()
    if (!ruleId) return
    setPublishRuleId(ruleId)
    setPublishError('')
    setConfirmPublish(true)
  }

  const publishTargets = recipients?.items.filter((item) => recipientIds.includes(item.id)) ?? []
  const publishLineCount = publishTargets.filter((item) => item.channels.line).length

  const confirmPublishSend = async () => {
    if (!selectedAccountId || !publishRuleId || saving) return
    setSaving(true); setPublishError('')
    try {
      await api.lineNotifications.operatorRules.publish(publishRuleId, selectedAccountId)
      setConfirmPublish(false)
      router.push(`/line-notifications?tab=operator&highlight=${encodeURIComponent(publishRuleId)}`)
    } catch (caught) {
      // M032: 生の `API error: NNN` を出さず、原因どおりに言い分ける。
      setPublishError(describeApiFailure(caught, '公開', {
        forbidden: 'このLINEアカウントのお知らせを公開する権限がありません。',
      }))
    } finally { setSaving(false) }
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
      // M032: 生の `API error: NNN` を出さず、原因どおりに言い分ける。
      setError(describeApiFailure(caught, 'テスト送信', {
        forbidden: 'このLINEアカウントのお知らせをテスト送信する権限がありません。',
      }))
    } finally { setSaving(false) }
  }

  return (
    <div data-design-node={editId ? 'hiBO8' : 'N2gAza'} data-selects-wide className="space-y-4 pb-24">
      {/* 板 hiBO8（運用者へのお知らせを編集する）。作るときは N2gAza。 */}
      <div className="flex items-center justify-between gap-3"><nav className="text-ink-faint text-xs" aria-label="パンくず">
        <Link href="/line-notifications" className="text-action hover:underline">LINE通知</Link><span className="mx-2">›</span><Link href="/line-notifications?tab=operator" className="text-action hover:underline">運用者へのお知らせ</Link><span className="mx-2">›</span><span>{editId ? 'なおす' : 'つくる'}</span>
      </nav><Button onClick={() => void testSend()} disabled={saving || ruleLoading}>自分にテストを送る</Button></div>

      <div className="mb-4"><NoteBar>宛先はお店の人です。あとから顧客向けへは変えられません。顧客へ送るものは別の画面で作ります。</NoteBar></div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <section className="border-hairline bg-canvas rounded-card border p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">どんなときに知らせるか</h2>
            <div className="grid gap-4 lg:grid-cols-3">
              <Field label="きっかけ" htmlFor="operator-event" required>
                <Select aria-label="きっかけ" id="operator-event" size="full" value={eventType} onChange={(value) => setEventType(value)} options={[...OPERATOR_EVENT_OPTIONS]} />
              </Field>
              <Field label="どれくらいたまったら" htmlFor="operator-threshold">
                <Select aria-label="どれくらいたまったら" id="operator-threshold" size="full" value={threshold} onChange={(value) => setThreshold(value)} options={THRESHOLD_OPTIONS} />
              </Field>
              <Field label="重要度" htmlFor="operator-importance">
                <Select aria-label="重要度" id="operator-importance" size="full" value={importance} onChange={(value) => setImportance(value)} options={IMPORTANCE_OPTIONS} />
              </Field>
            </div>
            <div className="mt-4 max-w-xl">
              <Field label="お知らせの名前" htmlFor="operator-name" required>
                <TextInput id="operator-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例：新しい予約が入りました" maxLength={80} />
              </Field>
            </div>
          </section>

          <section className="border-hairline bg-canvas rounded-card border p-5">
            <h2 className="text-sm font-semibold text-ink">だれが受け取るか</h2>
            <p className="mt-1 text-xs text-ink-faint">LINEログイン済みの人にだけ届きます。担当が決まっていないと届きません。</p>
            <div className="mt-4 grid max-w-3xl gap-3 sm:grid-cols-2"><Field label="送り先" htmlFor="operator-recipient-kind"><Select aria-label="送り先" id="operator-recipient-kind" size="full" value="staff" onChange={() => undefined} options={[{ value: 'staff', label: 'スタッフ' }]} /></Field><Field label="チーム" htmlFor="operator-recipient-team"><Select aria-label="チーム" id="operator-recipient-team" size="full" value="all" onChange={() => undefined} options={[{ value: 'all', label: `選択中のスタッフ（${recipientIds.length}人）` }]} /></Field></div>
            <div className="mt-3 flex flex-wrap gap-2">
              {recipients
                // R612: 候補0人では選ぶ操作自体ができない。準備と次の画面を案内する。
                ? (recipients.items.length === 0 ? (
                  <div>
                    <p className="text-sm font-semibold text-ink">受け取る人がいません</p>
                    <p className="mt-1 text-xs text-ink-secondary">スタッフを登録し、LINE連携が済んだ人が宛先になります。</p>
                    <Link href="/staff" className="mt-2 inline-block text-xs text-action hover:underline">ログインユーザーでスタッフを確認する</Link>
                  </div>
                ) : recipients.items.map((recipient) => { const selected = recipientIds.includes(recipient.id); return <Checkbox key={recipient.id} checked={selected} onCheckedChange={(checked) => setRecipientIds((current) => checked ? [...current, recipient.id] : current.filter((id) => id !== recipient.id))}>{recipient.name}{recipient.channels.line ? '' : '（LINE未連携）'}</Checkbox> }))
                : recipientsError !== null
                  ? (
                    <div className="space-y-2">
                      <p className="text-sm text-ink-secondary" role="alert">
                        {isForbiddenOrRateLimited(recipientsError)
                          ? loadFailureNotice(recipientsError, '受け取る人')
                          : '受け取る人を読み込めませんでした。時間をおいて、もう一度お試しください。'}
                      </p>
                      {isForbidden(recipientsError) ? null : (
                        <Button variant="secondary" size="compact" onClick={() => loadRecipients()}>もう一度読み込む</Button>
                      )}
                    </div>
                    )
                  : <p className="text-sm text-ink-faint">受け取る人を読み込んでいます…</p>}
            </div>
            {recipients && recipients.items.length > 0 ? <p className="mt-3 text-xs text-ink-secondary">選択 {recipientIds.length}人 ／ LINEで受け取れる {recipients.items.filter((item) => recipientIds.includes(item.id) && item.channels.line).length}人 ／ 管理画面で受け取れる {recipientIds.length}人</p> : null}
          </section>

          <section className="border-hairline bg-canvas rounded-card border p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">いつ送るか・重ならないか</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="送る時間" htmlFor="operator-schedule">
                <Select aria-label="送る時間" id="operator-schedule" size="full" value={schedule} onChange={(value) => setSchedule(value)} options={SCHEDULE_OPTIONS} />
              </Field>
              <Field label="同じ知らせを重ねない" htmlFor="operator-dedupe">
                <Select aria-label="同じ知らせを重ねない" id="operator-dedupe" size="full" value={dedupeMinutes} onChange={(value) => setDedupeMinutes(value)} options={DEDUPE_OPTIONS} />
              </Field>
            </div>
            <Checkbox
              checked={onlyAvailable}
              onCheckedChange={setOnlyAvailable}
              description="対応中の人には送りません。"
              className="mt-4"
            >手が空いている人だけに送る</Checkbox>
            <Checkbox
              checked={emailFallback}
              onCheckedChange={setEmailFallback}
              description="LINE未ログインの人がいるとき"
              className="mt-4"
            >だれも受け取れないときはメールでも送る</Checkbox>
          </section>

          {error ? <Notice tone="danger" message={error} /> : null}
          {notice ? <p role="status" className="border-success bg-success-bg text-success rounded-control border px-4 py-3 text-sm">{notice}</p> : null}
        </div>

        <aside className="space-y-4">
          <section className="border-hairline bg-canvas rounded-card border p-4">
            <div className="flex items-center gap-2"><Building2 aria-hidden="true" size={18} className="text-ink-faint" /><h2 className="text-sm font-semibold text-ink">お店の人にはこう届きます</h2></div>
            <p className="mt-2 whitespace-pre-wrap text-xs text-ink-faint">文面はここで確かめられます。<br />【運用者へのお知らせ】{name.trim() || 'お知らせ名'}</p>
          </section>
          <Notice tone="warn">
            <h2 className="text-sm font-semibold">気をつけること</h2>
            <ul className="mt-3 space-y-3 text-xs leading-5">
              <li>受け取る人が0人だと公開できません。</li>
              <li>お客様の連絡先は宛先に入りません。</li>
              <li>下書きを保存しても通知は始まりません。</li>
            </ul>
          </Notice>
          <section className="border-hairline bg-canvas rounded-card border p-4">
            <h2 className="text-sm font-semibold text-ink">つながる先</h2>
            <div className="mt-3 space-y-2 text-xs">
              {[
                ['/staff', 'ログインユーザー', '受け取る人とチーム'],
                ['/line-notifications', '顧客へのお知らせ', 'お客様に送るもの'],
                ['/health', '運用状態', '止まっているときの知らせ'],
                ['/line-notifications?tab=history', '記録', '届いたかどうかの確認'],
              ].map(([href, label, note]) => <Link key={href} href={href} className="flex items-center justify-between gap-2 text-action hover:underline"><span className="inline-flex items-center gap-1"><ArrowRight aria-hidden="true" size={13} />{label}</span><span className="text-ink-faint">{note}</span></Link>)}
            </div>
          </section>
        </aside>
      </div>

      <StickyBar
        status={ruleLoading ? '保存ずみのお知らせを読み込んでいます…' : savedRuleId ? '下書きを保存しました。テスト後に公開できます。' : '下書きです。保存しても通知は始まりません。'}
        actions={<>
          <Button href="/line-notifications?tab=operator" variant="secondary">キャンセル</Button>
          <Button onClick={() => void saveDraft()} disabled={saving || ruleLoading} busy={saving}>{savedRuleId ? '保存し直す' : '下書きを保存する'}</Button>
          <Button onClick={() => void publish()} disabled={saving || ruleLoading} variant="primary">運用者へのお知らせを公開</Button>
        </>}
      />
      <Dialog
        open={confirmPublish}
        title="このお知らせを公開しますか？"
        cancelLabel="戻って直す"
        confirmLabel={publishLineCount > 0 ? `公開して${publishLineCount}人にLINEで送る` : '公開する'}
        confirmIcon={<Send size={16} aria-hidden="true" />}
        busy={saving}
        error={publishError || undefined}
        designNode="sDXNy"
        onConfirm={() => void confirmPublishSend()}
        onCancel={() => { if (!saving) setConfirmPublish(false) }}
      >
        <div className="flex flex-col gap-4">
          <dl className="grid gap-1.5 rounded-card bg-canvas-sunken px-4 py-3">
            <div className="flex gap-3">
              <dt className="w-24 shrink-0 text-caption text-ink-faint">お知らせ</dt>
              <dd className="text-caption font-medium text-ink">{name.trim() || 'お知らせ名'}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-24 shrink-0 text-caption text-ink-faint">宛先</dt>
              <dd className="text-caption font-medium text-ink">{publishTargets.length}人</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-24 shrink-0 text-caption text-ink-faint">LINEが届く人</dt>
              <dd className="text-caption font-medium text-ink">
                {publishLineCount}人{publishTargets.length - publishLineCount > 0 ? `（${publishTargets.length - publishLineCount}人はLINE未登録）` : ''}
              </dd>
            </div>
          </dl>
          <ul className="grid gap-1.5">
            {publishTargets.map((target) => (
              <li key={target.id} className="flex items-center gap-3 border-b border-hairline pb-1.5">
                <span className="min-w-0 flex-1 truncate text-caption text-ink">{target.name}</span>
                {target.channels.line ? <Chip tone="ok">LINE</Chip> : <Chip tone="neutral">画面だけ</Chip>}
              </li>
            ))}
          </ul>
          <p className="text-caption text-ink-secondary">LINE未登録の人には、管理画面のお知らせだけで届きます。</p>
        </div>
      </Dialog>
      {/* U063: 選び欄は欄いっぱいに広げる（部品の size="full" を使う）。 */}
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力したお知らせ" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}

/*
 * ★V8-B: data-theme="v8" のときだけ新しい作成画面（`gjUz3`）を出す。
 * v7 の見た目は NewOperatorNotificationInner のまま変えない。
 */
function NewOperatorNotificationPageSwitch() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <NewOperatorNotificationV8 /> : <NewOperatorNotificationInner />
}

// useSearchParams を使うので、静的生成の境目に Suspense が要る。
export default function NewOperatorNotificationPage() {
  return (
    <Suspense>
      <NewOperatorNotificationPageSwitch />
    </Suspense>
  )
}

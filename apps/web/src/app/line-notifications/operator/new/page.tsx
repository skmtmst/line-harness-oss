'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, Building2, Users } from 'lucide-react'
import Button from '@/components/shared/button'
import { Field, TextInput } from '@/components/shared/form-controls'
import SelectField from '@/components/shared/select-field'
import StickyBar from '@/components/shared/sticky-bar'
import { useAccount } from '@/contexts/account-context'
import { ApiError, api, type OperatorRecipientPreview } from '@/lib/api'
import { usePageTitle } from '@/components/shell/page-chrome'

const EVENT_OPTIONS = [
  { value: 'message_received', label: '受信箱に届いたとき' },
  { value: 'friend_add', label: '友だちが追加されたとき' },
  { value: 'cv_fire', label: '成果が記録されたとき' },
  { value: 'incoming_webhook.custom', label: '外部連携のイベントを受け取ったとき' },
]

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

export default function NewOperatorNotificationPage() {
  usePageTitle('運用者へのお知らせをつくる')
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [eventType, setEventType] = useState('message_received')
  const [threshold, setThreshold] = useState('one')
  const [importance, setImportance] = useState('normal')
  const [name, setName] = useState('')
  const [recipients, setRecipients] = useState<OperatorRecipientPreview | null>(null)
  const [recipientIds, setRecipientIds] = useState<string[]>([])
  const [schedule, setSchedule] = useState('anytime')
  const [dedupeMinutes, setDedupeMinutes] = useState('10')
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const [message, setMessage] = useState('')
  const [savedRuleId, setSavedRuleId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    if (!selectedAccountId) { setRecipients(null); setRecipientIds([]); return }
    void api.notifications.operatorRules.previewRecipients({
      lineAccountId: selectedAccountId,
      channels: ['dashboard', 'line'],
    }).then((result) => {
      if (!active) return
      if (!result.success) throw new Error(result.error)
      setRecipients(result.data)
      setRecipientIds(result.data.items.map((item) => item.id))
    }).catch(() => {
      if (!active) return
      setRecipients(null)
      setError('受け取る人を読み込めませんでした。')
    })
    return () => { active = false }
  }, [selectedAccountId])

  const saveDraft = async () => {
    if (saving) return
    if (!selectedAccountId) {
      setError('LINEアカウントを選択してください。')
      return
    }
    if (!name.trim()) {
      setError('お知らせの名前を入力してください。')
      return
    }
    if (recipientIds.length === 0) {
      setError('受け取るスタッフを1人以上選んでください。')
      return
    }
    setSaving(true)
    setError('')
    try {
      const scheduleLabel = SCHEDULE_OPTIONS.find((option) => option.value === schedule)?.label ?? 'いつでも'
      const result = await api.notifications.rules.create({
        lineAccountId: selectedAccountId,
        name: name.trim(),
        eventType,
        conditions: {
          threshold,
          importance,
          recipientType: 'team',
          recipientIds,
          recipientLabel: `${recipientIds.length}人`,
          message: message.trim() || null,
          schedule,
          scheduleLabel,
          dedupeMinutes: Number(dedupeMinutes),
          onlyAvailable,
          lifecycle: 'draft',
        },
        channels: ['dashboard', 'line'],
      })
      if (!result.success) throw new Error('save failed')
      setSavedRuleId(result.data.id)
      setError('')
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) {
        setError('このLINEアカウントのお知らせを変更する権限がありません。')
      } else if (caught instanceof ApiError && caught.status === 400) {
        setError(caught.message)
      } else {
        setError('下書きを保存できませんでした。時間をおいてもう一度お試しください。')
      }
    } finally {
      setSaving(false)
    }
  }

  const publish = async () => {
    if (!selectedAccountId || !savedRuleId || saving) return
    setSaving(true); setError('')
    try {
      await api.notifications.operatorRules.publish(savedRuleId, selectedAccountId)
      router.push(`/line-notifications?tab=operator&highlight=${encodeURIComponent(savedRuleId)}`)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '公開できませんでした。')
    } finally { setSaving(false) }
  }

  const testSend = async () => {
    if (!selectedAccountId || !savedRuleId || saving) return
    setSaving(true); setError('')
    try {
      const result = await api.notifications.operatorRules.test(savedRuleId, selectedAccountId, message.trim() || undefined)
      if (!result.success) throw new Error(result.error)
      setError(result.data.accepted > 0 ? '自分へのテスト送信を受け付けました。' : '受け取れる通知方法がありません。受信設定を確認してください。')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'テスト送信できませんでした。')
    } finally { setSaving(false) }
  }

  return (
    <div data-design-node="N2gAza" className="space-y-4 pb-24">
      <nav className="text-ink-faint text-xs" aria-label="パンくず">
        <Link href="/line-notifications" className="text-accent hover:underline">LINE通知</Link>
        <span className="mx-2">›</span>
        <Link href="/line-notifications?tab=operator" className="text-accent hover:underline">運用者へのお知らせ</Link>
        <span className="mx-2">›</span>
        <span>つくる</span>
      </nav>

      <div className="border-info bg-info-bg text-info flex items-start gap-2 rounded-control border px-4 py-3 text-sm">
        <Users className="mt-0.5 shrink-0" aria-hidden="true" size={17} />
        <p>宛先はお店の人です。あとから顧客向けへは変えられません。顧客へ送るものは別の画面で作ります。</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <main className="space-y-4 xl:col-span-2">
          <section className="border-hairline bg-canvas rounded-card border p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">どんなときに知らせるか</h2>
            <div className="grid gap-4 lg:grid-cols-3">
              <Field label="きっかけ" htmlFor="operator-event" required>
                <SelectField id="operator-event" className="w-full" value={eventType} onChange={(event) => setEventType(event.target.value)} options={EVENT_OPTIONS} />
              </Field>
              <Field label="どれくらいたまったら" htmlFor="operator-threshold">
                <SelectField id="operator-threshold" className="w-full" value={threshold} onChange={(event) => setThreshold(event.target.value)} options={THRESHOLD_OPTIONS} />
              </Field>
              <Field label="重要度" htmlFor="operator-importance">
                <SelectField id="operator-importance" className="w-full" value={importance} onChange={(event) => setImportance(event.target.value)} options={IMPORTANCE_OPTIONS} />
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
            <p className="mt-1 text-xs text-ink-faint">LINEログインを済ませた人にだけ届きます。担当が決まっていないと届きません。</p>
            <div className="mt-4 space-y-2">
              {recipients ? recipients.items.map((recipient) => <label key={recipient.id} className="flex items-center justify-between gap-3 rounded-control border border-hairline px-3 py-2 text-sm"><span className="flex items-center gap-2"><input type="checkbox" checked={recipientIds.includes(recipient.id)} onChange={(event) => setRecipientIds((current) => event.target.checked ? [...current, recipient.id] : current.filter((id) => id !== recipient.id))} className="h-4 w-4 accent-accent" /><strong>{recipient.name}</strong></span><span className="text-xs text-ink-faint">管理画面{recipient.channels.line ? '・LINE' : '（LINE未連携）'}</span></label>) : <p className="text-sm text-ink-faint">受け取る人を読み込んでいます…</p>}
            </div>
            {recipients ? <p className="mt-3 text-xs text-ink-secondary">選択 {recipientIds.length}人 ／ LINEで受け取れる {recipients.items.filter((item) => recipientIds.includes(item.id) && item.channels.line).length}人 ／ 管理画面で受け取れる {recipientIds.length}人</p> : null}
          </section>

          <section className="border-hairline bg-canvas rounded-card border p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">いつ送るか・重ならないか</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="送る時間" htmlFor="operator-schedule">
                <SelectField id="operator-schedule" className="w-full" value={schedule} onChange={(event) => setSchedule(event.target.value)} options={SCHEDULE_OPTIONS} />
              </Field>
              <Field label="同じ知らせを重ねない" htmlFor="operator-dedupe">
                <SelectField id="operator-dedupe" className="w-full" value={dedupeMinutes} onChange={(event) => setDedupeMinutes(event.target.value)} options={DEDUPE_OPTIONS} />
              </Field>
            </div>
            <label className="mt-4 flex items-start gap-3 text-sm text-ink-secondary">
              <input type="checkbox" checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)} className="mt-0.5 h-4 w-4 accent-accent" />
              <span><strong className="block text-ink">手が空いている人だけに送る</strong><span className="text-xs text-ink-faint">対応中の人には送りません。</span></span>
            </label>
            <div className="mt-4 max-w-xl"><Field label="届く文面" htmlFor="operator-message" note="空欄なら、お知らせ名と管理画面への案内を送ります。"><TextInput id="operator-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="例：新しい予約が入りました。内容を確認してください。" maxLength={500} /></Field></div>
          </section>

          {error ? <p role="alert" className="border-danger bg-danger-bg text-danger rounded-control border px-4 py-3 text-sm">{error}</p> : null}
        </main>

        <aside className="space-y-4">
          <section className="border-hairline bg-canvas rounded-card border p-4">
            <div className="flex items-center gap-2"><Building2 aria-hidden="true" size={18} className="text-accent" /><h2 className="text-sm font-semibold text-ink">お店の人にはこう届きます</h2></div>
            <p className="mt-2 whitespace-pre-wrap text-xs text-ink-faint">{message.trim() || `【運用者へのお知らせ】${name.trim() || 'お知らせ名'}\n管理画面で内容を確認してください。`}</p>
          </section>
          <section className="border-warning bg-warning-bg text-warning rounded-card border p-4">
            <div className="flex items-center gap-2"><AlertTriangle aria-hidden="true" size={18} /><h2 className="text-sm font-semibold">気をつけること</h2></div>
            <ul className="mt-3 space-y-3 text-xs leading-5">
              <li>受け取る人が0人だと公開できません。</li>
              <li>お客様の連絡先は宛先に入りません。</li>
              <li>下書きを保存しても通知は始まりません。</li>
            </ul>
          </section>
          <section className="border-hairline bg-canvas rounded-card border p-4">
            <h2 className="text-sm font-semibold text-ink">つながる先</h2>
            <div className="mt-3 space-y-2 text-xs">
              {[
                ['/staff', 'ログインユーザー', '受け取る人とチーム'],
                ['/line-notifications', '顧客へのお知らせ', 'お客様に送るもの'],
                ['/health', '運用状態', '止まっているときの知らせ'],
                ['/line-notifications?tab=history', '記録', '届いたかどうかの確認'],
              ].map(([href, label, note]) => <Link key={href} href={href} className="flex items-center justify-between gap-2 text-accent hover:underline"><span className="inline-flex items-center gap-1"><ArrowRight aria-hidden="true" size={13} />{label}</span><span className="text-ink-faint">{note}</span></Link>)}
            </div>
          </section>
        </aside>
      </div>

      <StickyBar
        status={savedRuleId ? '下書きを保存しました。テスト後に公開できます。' : '下書きです。保存しても通知は始まりません。'}
        actions={<>
          <Button href="/line-notifications?tab=operator" variant="secondary">やめる</Button>
          {savedRuleId ? <Button onClick={() => void testSend()} disabled={saving}>自分にテスト送信</Button> : null}
          <Button onClick={() => void saveDraft()} disabled={saving || Boolean(savedRuleId)}>{saving ? '保存中…' : savedRuleId ? '保存済み' : '下書きに保存'}</Button>
          {savedRuleId ? <Button onClick={() => void publish()} disabled={saving} variant="primary">運用者へのお知らせを公開</Button> : null}
        </>}
      />
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { AlertTriangle, ArrowRight, Building2, Mail, Users } from 'lucide-react'
import Button from '@/components/shared/button'
import { Field, TextInput } from '@/components/shared/form-controls'
import SelectField from '@/components/shared/select-field'
import StickyBar from '@/components/shared/sticky-bar'
import { useAccount } from '@/contexts/account-context'
import { ApiError, api } from '@/lib/api'
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
  const [recipientLabel, setRecipientLabel] = useState('')
  const [schedule, setSchedule] = useState('anytime')
  const [dedupeMinutes, setDedupeMinutes] = useState('10')
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const [fallbackEmail, setFallbackEmail] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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
          recipientLabel: recipientLabel.trim() || null,
          schedule,
          scheduleLabel,
          dedupeMinutes: Number(dedupeMinutes),
          onlyAvailable,
          fallbackEmail,
          lifecycle: 'draft',
        },
        channels: fallbackEmail ? ['dashboard', 'email'] : ['dashboard'],
      })
      if (!result.success) throw new Error('save failed')
      router.push(`/line-notifications?tab=operator&highlight=${encodeURIComponent(result.data.id)}`)
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
            <p className="mt-1 text-xs text-ink-faint">いまは下書きにチーム名を保存します。実際のスタッフ人数は送信処理の接続後に確認します。</p>
            <div className="mt-4 max-w-xl">
              <Field label="受け取るチーム" htmlFor="operator-recipient" note="未入力の下書きは公開できません。">
                <TextInput id="operator-recipient" value={recipientLabel} onChange={(event) => setRecipientLabel(event.target.value)} placeholder="例：予約チーム" maxLength={80} />
              </Field>
            </div>
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
            <label className="mt-4 flex items-start gap-3 text-sm text-ink-secondary">
              <input type="checkbox" checked={fallbackEmail} onChange={(event) => setFallbackEmail(event.target.checked)} className="mt-0.5 h-4 w-4 accent-accent" />
              <span><strong className="block text-ink">だれも受け取れないときはメールでも送る</strong><span className="text-xs text-ink-faint">メール送信は実行処理の接続後に有効になります。</span></span>
            </label>
          </section>

          {error ? <p role="alert" className="border-danger bg-danger-bg text-danger rounded-control border px-4 py-3 text-sm">{error}</p> : null}
        </main>

        <aside className="space-y-4">
          <section className="border-hairline bg-canvas rounded-card border p-4">
            <div className="flex items-center gap-2"><Building2 aria-hidden="true" size={18} className="text-accent" /><h2 className="text-sm font-semibold text-ink">お店の人にはこう届きます</h2></div>
            <p className="mt-2 text-xs text-ink-faint">文面と遷移先は、送信処理を接続するときに確認します。</p>
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
          {fallbackEmail ? <div className="border-hairline bg-canvas flex items-start gap-2 rounded-card border p-4 text-xs text-ink-secondary"><Mail aria-hidden="true" size={16} className="mt-0.5 shrink-0" />メールは受け取る人の確認済みアドレスだけに送ります。</div> : null}
        </aside>
      </div>

      <StickyBar
        status="下書きです。保存しても通知は始まりません。"
        actions={<>
          <Button href="/line-notifications?tab=operator" variant="secondary">やめる</Button>
          <Button onClick={() => void saveDraft()} disabled={saving} variant="primary">{saving ? '保存中…' : '下書きに保存'}</Button>
        </>}
      />
    </div>
  )
}

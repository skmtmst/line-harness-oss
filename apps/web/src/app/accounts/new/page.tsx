'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import PageHeader from '@/components/shared/page-header'
import StickyBar from '@/components/shared/sticky-bar'
import StatusBadge from '@/components/shared/status-badge'
import {
  AccountFormSections,
  emptyAccountFormState,
  type AccountFormState,
} from '@/components/accounts/account-form-fields'
import {
  CHECK_STATE_LABEL,
  canSave,
  capacityError,
  stoppedAt,
  toSteps,
  type VerifyResult,
} from '../connection-check-view'

/**
 * LINEアカウントを登録する。設計 ★V6 33-2（`b2NGxk`）。
 *
 * **これまでここは店舗ウィザードへの転送だった。** 店舗を作ることと、
 * LINE公式アカウントを登録することは別（要件 §5-3）。
 *
 * **確かめてから保存する。** 通らないまま保存すると、「登録できたのに
 * 届かない」という一番わかりにくい壊れ方になる。
 */
export default function NewLineAccountPage() {
  const router = useRouter()
  const [form, setForm] = useState<AccountFormState>(emptyAccountFormState)
  const [capacity, setCapacity] = useState('')
  const [warnAt, setWarnAt] = useState('')
  const [verify, setVerify] = useState<VerifyResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const steps = useMemo(() => toSteps(verify), [verify])
  const stopped = stoppedAt(steps)
  const capacityMessage = capacityError(capacity, warnAt)

  const update = (partial: Partial<AccountFormState>) => setForm((f) => ({ ...f, ...partial }))

  /**
   * 確かめてから保存する。**どこかで止まったら保存しない。**
   * 確かめるだけでは記録を残さない（設計の一言どおり）。
   */
  const verifyAndSave = async () => {
    if (capacityMessage) return
    setBusy(true)
    setError('')
    try {
      const checked = await api.lineAccounts.verifyConnection({
        channelAccessToken: form.channelAccessToken,
        loginChannelId: form.loginChannelId,
        loginChannelSecret: form.loginChannelSecret,
        liffId: form.liffId,
      })
      if (!checked.success) { setError(checked.error); return }
      setVerify(checked.data)
      if (!canSave(toSteps(checked.data))) return

      const created = await api.lineAccounts.create({
        channelId: form.channelId,
        name: form.name,
        channelAccessToken: form.channelAccessToken,
        channelSecret: form.channelSecret,
        loginChannelId: form.loginChannelId || null,
        loginChannelSecret: form.loginChannelSecret || null,
        liffId: form.liffId || null,
      })
      if (!created.success) { setError(created.error); return }
      router.push(`/accounts/${created.data.id}`)
    } catch {
      setError('登録できませんでした。しばらくおいてから、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-design-node="b2NGxk" className="pb-24">
      <PageHeader
        breadcrumb={[{ label: 'LINEアカウント', href: '/accounts' }, { label: '登録' }]}
        title="LINEアカウントを登録"
        description="送受信に使うLINE公式アカウントを登録します。保存する前に接続を確かめます。"
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <AccountFormSections state={form} update={update} showMessagingRequired />

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-bold">保存する前の接続確認</p>
            <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
              「接続を確かめて保存」を押すと、次の順で確かめます。どこかで止まったら保存しません。
              確かめるだけで、記録は残りません。
            </p>
            <ol className="mt-3 space-y-2">
              {steps.map((step) => (
                <li key={step.order} className="border-hairline rounded-control flex items-start gap-3 border p-3">
                  <span className="text-ink-faint w-4 shrink-0 text-xs tabular-nums">{step.order}</span>
                  <span className="text-ink min-w-0 flex-1 text-xs leading-relaxed">{step.label}</span>
                  {/* **色だけに頼らず、必ず文字で状態を言う。** */}
                  <StatusBadge
                    tone={step.state === 'passed' ? 'success' : step.state === 'failed' ? 'warning' : 'neutral'}
                  >
                    {CHECK_STATE_LABEL[step.state]}
                  </StatusBadge>
                </li>
              ))}
            </ol>
            {stopped && (
              <p role="alert" className="bg-warning-bg text-warning rounded-control mt-3 p-3 text-xs leading-relaxed">
                {stopped.order} で止まりました。右の「Webhookのつなぎ先」にあるURLを LINE Developers
                のチャネル設定に貼り、「Webhookの利用」をオンにしてください。
                4 は 3 が通るまで確かめられません。
              </p>
            )}
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-bold">友だち数の見張り（任意）</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-ink-secondary mb-1 block text-xs font-medium">友だち数の上限</span>
                <input
                  type="number" inputMode="numeric" value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="例：50000"
                  className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-ink-secondary mb-1 block text-xs font-medium">警告を出す友だち数</span>
                <input
                  type="number" inputMode="numeric" value={warnAt}
                  onChange={(e) => setWarnAt(e.target.value)}
                  placeholder="例：45000"
                  aria-invalid={capacityMessage ? true : undefined}
                  className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                />
              </label>
            </div>
            {capacityMessage && (
              <p role="alert" className="text-danger mt-2 text-xs">{capacityMessage}</p>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-bold">Webhookのつなぎ先</p>
            <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
              下のURLを LINE Developers のチャネル設定に貼り、「Webhookの利用」をオンにしてください。
              URLはアカウントごとに変わりません。
            </p>
            {/*
              **確かめる前はURLを作らない。** 接続確認の返事に入っている
              URLだけを出す。想像で組み立てると、貼り間違いのもとになる。
            */}
            <p className="text-ink-faint mt-3 text-xs leading-relaxed">
              {verify?.webhookUrl
                ? verify.webhookUrl
                : '「接続を確かめて保存」を押すと、貼り付けるURLがここに出ます。'}
            </p>
          </section>
        </aside>
      </div>

      <StickyBar
        className="mt-4"
        status={verify ? (stopped ? `${stopped.order} で止まっています` : '確かめました') : 'まだ確かめていません'}
        actions={(
          <>
            <Button href="/accounts">やめる</Button>
            <Button
              type="button" variant="primary"
              disabled={busy || Boolean(capacityMessage)}
              onClick={() => void verifyAndSave()}
            >
              {busy ? '確かめています…' : '接続を確かめて保存'}
            </Button>
          </>
        )}
      />

      {error && <p role="alert" className="text-danger mt-3 text-sm">{error}</p>}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Gift, ShieldCheck } from 'lucide-react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { Field, TextArea, TextInput } from '@/components/shared/form-controls'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import { useAccount } from '@/contexts/account-context'
import {
  api,
  type CommonActionDetail,
  type MileageReward,
  type MileageRewardDraft,
  type MileageRewardKind,
} from '@/lib/api'

type FormState = {
  name: string
  description: string
  rewardKind: MileageRewardKind
  requiredMiles: string
  stockLimit: string
  perFriendLimit: string
  startsAt: string
  endsAt: string
  benefitExpiresDays: string
  commonActionVersionId: string
  failurePolicy: 'retry' | 'refund' | 'manual'
  customerMessage: string
  couponCodes: string
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  rewardKind: 'coupon',
  requiredMiles: '1000',
  stockLimit: '',
  perFriendLimit: '1',
  startsAt: '',
  endsAt: '',
  benefitExpiresDays: '',
  commonActionVersionId: '',
  failurePolicy: 'retry',
  customerMessage: 'マイルの交換が完了しました。',
  couponCodes: '',
}

const KIND_OPTIONS = [
  { value: 'coupon', label: '交換コードを渡す' },
  { value: 'tag', label: 'タグを付ける' },
  { value: 'scenario', label: 'シナリオを始める' },
  { value: 'template', label: '案内を送る' },
  { value: 'early_access', label: '先行案内を届ける' },
  { value: 'rank', label: 'ランクを変更する' },
]

function dateTimeInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function optionalNumber(value: string) {
  return value.trim() === '' ? null : Number(value)
}

function safeError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('403')) return 'この操作を行う権限がありません。'
  if (message.includes('409')) return 'ほかの人が先に変更しました。読み直してからお試しください。'
  if (message.includes('405')) return 'この環境では使い道を変更できません。'
  return fallback
}

export default function MileageRewardEditor({ rewardId }: { rewardId?: string }) {
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [reward, setReward] = useState<MileageReward | null>(null)
  const [actions, setActions] = useState<CommonActionDetail[]>([])
  const [loading, setLoading] = useState(Boolean(rewardId))
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [saving, setSaving] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setLoadError('')
    try {
      const [rewardResponse, actionResponse] = await Promise.all([
        rewardId ? api.mileage.reward(rewardId, selectedAccountId) : Promise.resolve(null),
        api.commonActions.list({ accountId: selectedAccountId, status: 'published' }),
      ])
      if (rewardResponse && !rewardResponse.success) throw new Error(rewardResponse.error)
      if (!actionResponse.success) throw new Error(actionResponse.error)

      const actionDetails = await Promise.all(
        actionResponse.data.map(async (item) => {
          const response = await api.commonActions.get(item.id, selectedAccountId)
          if (!response.success) throw new Error(response.error)
          return response.data
        }),
      )
      setActions(actionDetails.filter((item) => item.currentPublishedVersionId))

      if (rewardResponse?.success) {
        const item = rewardResponse.data
        const version = item.currentVersion
        setReward(item)
        setForm({
          name: item.name,
          description: item.description ?? '',
          rewardKind: item.rewardKind,
          requiredMiles: String(version?.requiredMiles ?? 1000),
          stockLimit: version?.stockLimit == null ? '' : String(version.stockLimit),
          perFriendLimit: version?.perFriendLimit == null ? '' : String(version.perFriendLimit),
          startsAt: dateTimeInput(version?.startsAt ?? null),
          endsAt: dateTimeInput(version?.endsAt ?? null),
          benefitExpiresDays: version?.benefitExpiresDays == null ? '' : String(version.benefitExpiresDays),
          commonActionVersionId: version?.commonActionVersionId ?? '',
          failurePolicy: version?.failurePolicy ?? 'retry',
          customerMessage: version?.customerMessage ?? '',
          couponCodes: '',
        })
      }
    } catch (error) {
      setLoadError(safeError(error, '使い道の編集内容を読み込めませんでした。'))
    } finally {
      setLoading(false)
    }
  }, [rewardId, selectedAccountId])

  useEffect(() => { void load() }, [load])

  const validationError = useMemo(() => {
    if (!form.name.trim()) return '使い道の名前を入力してください。'
    const miles = Number(form.requiredMiles)
    if (!Number.isInteger(miles) || miles <= 0) return '必要マイルは1以上の整数で入力してください。'
    const stock = optionalNumber(form.stockLimit)
    if (stock != null && (!Number.isInteger(stock) || stock <= 0)) return '交換できる総数は1以上の整数で入力してください。'
    const perFriend = optionalNumber(form.perFriendLimit)
    if (perFriend != null && (!Number.isInteger(perFriend) || perFriend <= 0)) return '1人あたりの回数は1以上の整数で入力してください。'
    if (form.startsAt && form.endsAt && new Date(form.startsAt) >= new Date(form.endsAt)) return '終了日時は開始日時より後にしてください。'
    if (form.rewardKind !== 'coupon' && !form.commonActionVersionId) return '渡す動きを選んでください。'
    if (form.rewardKind === 'coupon' && !reward?.currentPublishedVersionId && !form.couponCodes.trim()) return '公開前に交換コードを1件以上入力してください。'
    return null
  }, [form, reward?.currentPublishedVersionId])

  const draft = (): MileageRewardDraft => ({
    name: form.name.trim(),
    description: form.description.trim() || null,
    rewardKind: form.rewardKind,
    requiredMiles: Number(form.requiredMiles),
    stockLimit: optionalNumber(form.stockLimit),
    perFriendLimit: optionalNumber(form.perFriendLimit),
    startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
    endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
    benefitExpiresDays: optionalNumber(form.benefitExpiresDays),
    commonActionVersionId: form.rewardKind === 'coupon' ? null : form.commonActionVersionId,
    failurePolicy: form.failurePolicy,
    customerMessage: form.customerMessage.trim(),
  })

  const saveDraft = async () => {
    if (!selectedAccountId) throw new Error('公式アカウントを選んでください。')
    if (validationError) throw new Error(validationError)

    let current = reward
    if (!current) {
      const response = await api.mileage.createReward(selectedAccountId, draft())
      if (!response.success) throw new Error(response.error)
      current = response.data
    } else {
      if (!current.currentDraftVersionId) {
        const response = await api.mileage.createRewardDraft(current.id, selectedAccountId)
        if (!response.success) throw new Error(response.error)
        current = response.data
      }
      const expectedVersionId = current.currentDraftVersionId
      if (!expectedVersionId) throw new Error('編集する版を用意できませんでした。')
      const response = await api.mileage.updateRewardDraft(current.id, selectedAccountId, expectedVersionId, draft())
      if (!response.success) throw new Error(response.error)
      current = response.data
    }

    const codes = form.couponCodes.split(/\r?\n/).map((code) => code.trim()).filter(Boolean)
    if (form.rewardKind === 'coupon' && codes.length > 0) {
      const response = await api.mileage.importRewardCodes(current.id, selectedAccountId, codes)
      if (!response.success) throw new Error(response.error)
      set('couponCodes', '')
    }
    setReward(current)
    return current
  }

  const save = async () => {
    setSaving(true)
    setActionError('')
    try {
      const saved = await saveDraft()
      router.replace(`/mileage/rewards/edit?id=${encodeURIComponent(saved.id)}`)
    } catch (error) {
      setActionError(safeError(error, error instanceof Error ? error.message : '下書きを保存できませんでした。'))
    } finally {
      setSaving(false)
    }
  }

  const publish = async () => {
    if (!selectedAccountId) return
    setSaving(true)
    setActionError('')
    try {
      const saved = await saveDraft()
      const response = await api.mileage.publishReward(saved.id, selectedAccountId)
      if (!response.success) throw new Error(response.error)
      setReward(response.data)
      setPublishOpen(false)
      router.replace('/mileage?tab=rewards')
    } catch (error) {
      setActionError(safeError(error, error instanceof Error ? error.message : '公開できませんでした。'))
    } finally {
      setSaving(false)
    }
  }

  if (accountLoading || loading) return <ListState kind="loading" title="使い道を読み込んでいます" description="このまま少しお待ちください。" />
  if (!selectedAccountId) return <ListState kind="forbidden" title="公式アカウントを選んでください" description="使い道は公式アカウントごとに管理します。" />
  if (loadError) return <ListState kind="error" title="使い道を表示できませんでした" description={loadError} action={<Button onClick={() => void load()}>再読み込み</Button>} />

  const selectedAction = actions.find((item) => item.currentPublishedVersionId === form.commonActionVersionId)
  const isPublishedWithoutDraft = Boolean(reward?.currentPublishedVersionId && !reward.currentDraftVersionId)

  return (
    <div data-design-node="p9CcEB" className="space-y-4 pb-24">
      {isPublishedWithoutDraft ? (
        <div className="flex items-start gap-3 rounded-v6-card border border-v6-action/25 bg-v6-action-soft p-4 text-sm text-v6-ink">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div><p className="font-semibold">公開中の版はそのまま保たれます</p><p className="mt-1 text-xs">編集を始めると前の版から新しい下書きを作ります。公開するまで、友だちが使う内容は変わりません。</p></div>
        </div>
      ) : null}

      <div className="mileage-reward-editor-columns grid gap-4">
        <div className="space-y-5 rounded-v6-card border border-hairline bg-canvas p-6">
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-v6-ink">1. 友だちに見える内容</h2>
            <Field label="使い道の名前" htmlFor="reward-name" required>
              <TextInput id="reward-name" value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="例：500円分の交換コード" />
            </Field>
            <Field label="説明" htmlFor="reward-description" note="交換すると何が受け取れるかを短く書きます。">
              <TextArea id="reward-description" rows={3} value={form.description} onChange={(event) => set('description', event.target.value)} />
            </Field>
            <Field label="交換完了後の案内" htmlFor="reward-message" required>
              <TextArea id="reward-message" rows={3} value={form.customerMessage} onChange={(event) => set('customerMessage', event.target.value)} />
            </Field>
          </section>

          <section className="space-y-4 border-t border-v6-divider pt-5">
            <h2 className="text-sm font-semibold text-v6-ink">2. 必要なマイルと回数</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="必要マイル" htmlFor="reward-miles" required><TextInput id="reward-miles" type="number" min={1} step={1} value={form.requiredMiles} onChange={(event) => set('requiredMiles', event.target.value)} /></Field>
              <Field label="交換できる総数" htmlFor="reward-stock" note="空欄なら上限なし"><TextInput id="reward-stock" type="number" min={1} step={1} value={form.stockLimit} onChange={(event) => set('stockLimit', event.target.value)} /></Field>
              <Field label="1人あたり" htmlFor="reward-person-limit" note="空欄なら上限なし"><TextInput id="reward-person-limit" type="number" min={1} step={1} value={form.perFriendLimit} onChange={(event) => set('perFriendLimit', event.target.value)} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="開始日時" htmlFor="reward-start"><TextInput id="reward-start" type="datetime-local" value={form.startsAt} onChange={(event) => set('startsAt', event.target.value)} /></Field>
              <Field label="終了日時" htmlFor="reward-end"><TextInput id="reward-end" type="datetime-local" value={form.endsAt} onChange={(event) => set('endsAt', event.target.value)} /></Field>
            </div>
          </section>

          <section className="space-y-4 border-t border-v6-divider pt-5">
            <h2 className="text-sm font-semibold text-v6-ink">3. 交換したときに渡すもの</h2>
            <Field label="渡すもの" required>
              <Select aria-label="渡すもの" size="full" value={form.rewardKind} options={KIND_OPTIONS} onChange={(value) => set('rewardKind', value as MileageRewardKind)} />
            </Field>
            {form.rewardKind === 'coupon' ? (
              <Field label="交換コード" htmlFor="reward-codes" required={!reward?.currentPublishedVersionId} note="1行に1件。保存後は安全のため画面へ戻しません。追加分だけを入力してください。">
                <TextArea id="reward-codes" rows={7} value={form.couponCodes} onChange={(event) => set('couponCodes', event.target.value)} placeholder={'CODE-001\nCODE-002'} autoComplete="off" />
              </Field>
            ) : (
              <Field label="渡す動き" required note="公開済みの共通アクションの版を固定して使います。後から共通アクションを編集しても、公開済みの使い道は変わりません。">
                <Select aria-label="渡す動き" size="full" value={form.commonActionVersionId} options={[{ value: '', label: '選んでください', disabled: true }, ...actions.map((item) => ({ value: item.currentPublishedVersionId ?? '', label: item.name }))]} onChange={(value) => set('commonActionVersionId', value)} />
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="受け取ったものの期限" htmlFor="reward-expiry" note="日数。空欄なら期限なし"><TextInput id="reward-expiry" type="number" min={1} step={1} value={form.benefitExpiresDays} onChange={(event) => set('benefitExpiresDays', event.target.value)} /></Field>
              <Field label="渡せなかったとき">
                <Select aria-label="渡せなかったとき" size="full" value={form.failurePolicy} options={[{ value: 'retry', label: '時間をあけてもう一度試す' }, { value: 'refund', label: 'マイルを自動で戻す' }, { value: 'manual', label: '運用者が確認して対応する' }]} onChange={(value) => set('failurePolicy', value as FormState['failurePolicy'])} />
              </Field>
            </div>
          </section>

          {actionError || validationError ? <p role="alert" className="rounded-v6-control border border-v6-danger-border bg-v6-danger-bg p-3 text-sm text-v6-danger">{actionError || validationError}</p> : null}
        </div>

        <aside className="space-y-4">
          <section className="rounded-v6-card border border-hairline bg-canvas p-5">
            <h2 className="text-sm font-semibold text-v6-ink">友だちに見える内容</h2>
            <div className="mt-4 rounded-v6-card border border-hairline p-4">
              <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-v6-purple-bg text-v6-purple"><Gift className="h-5 w-5" /></span><div><p className="font-semibold text-v6-ink">{form.name || '使い道の名前'}</p><p className="text-xs text-v6-ink-faint">{Number(form.requiredMiles || 0).toLocaleString('ja-JP')} mile</p></div></div>
              <p className="mt-4 text-sm text-v6-ink-secondary">{form.description || '交換すると受け取れるものの説明が表示されます。'}</p>
              <p className="mt-4 text-xs text-v6-ink-faint">{form.rewardKind === 'coupon' ? '交換コードを1件渡します' : selectedAction ? `「${selectedAction.name}」を実行します` : '渡す動きを選んでください'}</p>
            </div>
          </section>
          <section className="rounded-v6-card border border-v6-warning/30 bg-v6-warning-bg p-5 text-sm text-v6-warning">
            <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">公開前に確認してください</p><ul className="mt-2 list-disc space-y-1 pl-4 text-xs"><li>公開した版は後から書き換えません</li><li>交換は同じ操作を繰り返しても1回だけです</li><li>渡せなかったときの再試行・返金方法を決めます</li></ul></div></div>
          </section>
        </aside>
      </div>

      <div className="sticky bottom-0 z-10 flex items-center justify-between rounded-v6-card border border-hairline bg-canvas/95 px-5 py-3 shadow-v6-card backdrop-blur">
        <Button href="/mileage?tab=rewards">戻る</Button>
        <div className="flex gap-2"><Button disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '下書きを保存'}</Button><Button variant="primary" disabled={saving || Boolean(validationError)} onClick={() => setPublishOpen(true)}>公開する</Button></div>
      </div>

      <ConfirmDialog open={publishOpen} title="この使い道を公開しますか" description="公開すると、友だちがこの内容で交換できるようになります。公開済みの版は固定され、次の変更は新しい下書きとして作ります。" confirmLabel="この内容で公開" busy={saving} error={actionError || undefined} onCancel={() => setPublishOpen(false)} onConfirm={() => void publish()} />
      <style jsx>{`@media (min-width: 1280px) { .mileage-reward-editor-columns { grid-template-columns: minmax(0, 1fr) 390px; } }`}</style>
    </div>
  )
}

'use client'

/*
 * ★V8-B マイル「使い道を作る・編集する」（板 `L2Bzp`）。
 *
 * 入力欄と保存の口は v7（rewards/edit/page.tsx・reward-form.ts）と同じ。
 * 違いは置き場と見せ方——左に「基本・渡すもの・だれが交換できるか・
 * 出す数と期間」の段、右にお客さまの画面での見え方と出す前の
 * 交換テスト、下に追従の帯（キャンセル・下書きを保存・保存して出す）。
 * 欄は1つも落とさない（種類の6択・共通アクション・条件・テスト・公開）。
 */

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check } from 'lucide-react'
import Link from 'next/link'
import Button from '@/components/shared/button'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import ConditionBuilder, { pruneCondition } from '@/components/shared/condition-builder'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { Field, TextArea, TextInput } from '@/components/shared/form-controls'
import DateTimeField from '@/components/shared/date-time-field'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { useAccount } from '@/contexts/account-context'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { localDateTime, utcDateTime } from '@/lib/presentation'
import { LIMIT_FIELD_ERRORS, normalizeDigits, optionalInteger, validateReward, type FormState } from './reward-form'
import {
  api,
  ApiError,
  type MileageRewardDraftInput,
  type MileageRewardFailurePolicy,
  type MileageRewardKind,
  type MileageRewardSummary,
  type MileageRewardTestResult,
} from '@/lib/api'
import { formatNumber } from '@/lib/format'
import formStyles from '../../earning-rules/new/v8-create-form.module.css'

type CommonActionOption = { id: string; label: string }

const KINDS: ReadonlyArray<{ value: MileageRewardKind; label: string; note: string }> = [
  { value: 'coupon', label: 'クーポンを渡す', note: '引換コードを配ります。交換後の動きを選ばなくても出せます' },
  { value: 'tag', label: 'タグを付ける', note: '付けたタグで、配信や絞り込みにつなげます' },
  { value: 'scenario', label: 'シナリオを始める', note: '交換した人だけに、続きの案内を流します' },
  { value: 'template', label: 'メッセージを送る', note: 'ひな形をそのまま1通送ります' },
  { value: 'early_access', label: '先にお知らせする', note: '一般より早く案内します' },
  { value: 'rank', label: 'ランクを上げる', note: 'ブロンズ・シルバーなどの段を上げます' },
]

const FAILURE_POLICIES: ReadonlyArray<{ value: MileageRewardFailurePolicy; label: string }> = [
  { value: 'retry', label: 'もう一度試す（おすすめ）' },
  { value: 'refund', label: 'マイルを返す' },
  { value: 'manual', label: '担当者が手で対応する' },
]

const EMPTY: FormState = {
  name: '',
  description: '',
  rewardKind: 'coupon',
  requiredMiles: '',
  stockLimit: '',
  perFriendLimit: '',
  startsAt: '',
  endsAt: '',
  benefitExpiresDays: '',
  commonActionVersionId: '',
  targetConditions: null,
  failurePolicy: 'retry',
  customerMessage: '',
}

function formOf(reward: MileageRewardSummary): FormState {
  const version = reward.currentVersion
  return {
    name: reward.name,
    description: reward.description ?? '',
    rewardKind: reward.rewardKind,
    requiredMiles: version ? String(version.requiredMiles) : '',
    stockLimit: version?.stockLimit == null ? '' : String(version.stockLimit),
    perFriendLimit: version?.perFriendLimit == null ? '' : String(version.perFriendLimit),
    startsAt: localDateTime(version?.startsAt),
    endsAt: localDateTime(version?.endsAt),
    benefitExpiresDays: version?.benefitExpiresDays == null ? '' : String(version.benefitExpiresDays),
    commonActionVersionId: version?.commonActionVersionId ?? '',
    targetConditions: version?.targetConditions ?? null,
    failurePolicy: version?.failurePolicy ?? 'retry',
    customerMessage: version?.customerMessage ?? '',
  }
}

function isMileageRewardSummary(value: unknown): value is MileageRewardSummary {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MileageRewardSummary>
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.rewardKind === 'string'
    && typeof candidate.status === 'string'
    && (candidate.currentVersion === null || typeof candidate.currentVersion === 'object')
}

function numberOrNull(value: string): number | null {
  const parsed = optionalInteger(value)
  if (parsed === undefined) throw new Error('数の限り・上限・日数の入力を確認してください')
  return parsed
}

function draftOf(form: FormState): MileageRewardDraftInput {
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    rewardKind: form.rewardKind,
    requiredMiles: Number(form.requiredMiles),
    stockLimit: numberOrNull(form.stockLimit),
    perFriendLimit: numberOrNull(form.perFriendLimit),
    startsAt: utcDateTime(form.startsAt),
    endsAt: utcDateTime(form.endsAt),
    benefitExpiresDays: numberOrNull(form.benefitExpiresDays),
    commonActionVersionId: form.commonActionVersionId.trim() || null,
    targetConditions: pruneCondition(form.targetConditions),
    failurePolicy: form.failurePolicy,
    customerMessage: form.customerMessage.trim(),
  }
}

function RewardEditorInner() {
  const router = useRouter()
  const rewardId = useSearchParams().get('id')
  const editing = Boolean(rewardId)
  const { selectedAccountId } = useAccount()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [reward, setReward] = useState<MileageRewardSummary | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>(editing ? 'loading' : 'ready')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<MileageRewardTestResult | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [failure, setFailure] = useState('')
  const [commonActions, setCommonActions] = useState<CommonActionOption[]>([])
  const [commonActionsFailed, setCommonActionsFailed] = useState(false)
  const [touched, setTouched] = useState(false)
  const [audience, setAudience] = useState<'all' | 'conditioned'>('all')
  const [baseline, setBaseline] = useState(() => JSON.stringify(EMPTY))

  const load = useCallback(async () => {
    if (!rewardId || !selectedAccountId) return
    setState('loading')
    try {
      const [detail, overview] = await Promise.all([
        api.mileage.reward(rewardId, selectedAccountId).catch(() => null),
        api.mileage.rewards(selectedAccountId).catch(() => null),
      ])
      const fallback = overview?.success
        ? overview.data.rewards.find((item) => item.id === rewardId)
        : undefined
      const found = detail?.success && isMileageRewardSummary(detail.data) ? detail.data : fallback
      if (!found) throw new Error('failed')
      setReward(found)
      const loaded = formOf(found)
      setForm(loaded)
      setAudience(loaded.targetConditions ? 'conditioned' : 'all')
      setBaseline(JSON.stringify(loaded))
      setState('ready')
    } catch (err) {
      setState(err instanceof ApiError && err.status === 403 ? 'forbidden' : 'error')
    }
  }, [rewardId, selectedAccountId])

  useEffect(() => {
    if (!selectedAccountId) {
      setCommonActions([])
      return
    }
    let cancelled = false
    setCommonActionsFailed(false)
    void api.commonActions.resources(selectedAccountId).then((response) => {
      if (!response.success) throw new Error(response.error)
      if (!cancelled) setCommonActions(response.data.commonActions.map((item) => ({
        id: item.currentPublishedVersionId,
        label: `${item.name}（公開版 v${item.version}）`,
      })))
    }).catch(() => {
      if (!cancelled) setCommonActionsFailed(true)
    })
    return () => { cancelled = true }
  }, [selectedAccountId])

  useEffect(() => {
    if (!editing) { setState('ready'); return }
    void load()
  }, [editing, load])

  const errors = validateReward(form)
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((now) => ({ ...now, [key]: value }))
    setFailure('')
    setTestResult(null)
  }

  const persistDraft = async () => {
    if (!selectedAccountId) throw new Error('account-required')
    const draft = draftOf(form)
    let saved
    if (rewardId) {
      let expectedVersionId = reward?.currentDraftVersionId
      let expectedRevision = reward?.currentVersion?.revision
      if (!expectedVersionId || expectedRevision == null) {
        const createdDraft = await api.mileage.createRewardDraft(rewardId, selectedAccountId)
        if (!createdDraft.success || !createdDraft.data.currentDraftVersionId) throw new Error('failed')
        expectedVersionId = createdDraft.data.currentDraftVersionId
        expectedRevision = createdDraft.data.currentVersion?.revision
      }
      if (expectedRevision == null) throw new Error('failed')
      saved = await api.mileage.saveRewardDraft(
        rewardId,
        selectedAccountId,
        expectedVersionId,
        expectedRevision,
        draft,
      )
    } else {
      saved = await api.mileage.createReward(selectedAccountId, draft)
    }
    if (!saved.success) throw new Error('failed')
    setReward(saved.data)
    setBaseline(JSON.stringify(form))
    if (!rewardId) router.replace(`/mileage/rewards/edit?id=${encodeURIComponent(saved.data.id)}`)
    return saved.data
  }

  const save = async (thenPublish: boolean) => {
    setTouched(true)
    if (!selectedAccountId || errors.length > 0) return
    setSaving(true)
    setFailure('')
    try {
      const saved = await persistDraft()
      if (thenPublish) {
        const published = await api.mileage.publishReward(
          saved.id,
          selectedAccountId,
          saved.currentDraftVersionId ?? saved.currentVersion?.id,
          saved.currentVersion?.revision,
        )
        if (!published.success) throw new Error('failed')
      }
      setPublishOpen(false)
      router.push('/mileage?tab=rewards')
    } catch (err) {
      setFailure(
        err instanceof ApiError && err.message && !/^API error/.test(err.message)
          ? err.message
          : '保存できませんでした。時間をおいてもう一度お試しください。',
      )
    } finally {
      setSaving(false)
    }
  }

  const testExchange = async () => {
    setTouched(true)
    if (!selectedAccountId || errors.length > 0) return
    setTesting(true)
    setFailure('')
    setTestResult(null)
    try {
      const saved = await persistDraft()
      const tested = await api.mileage.testReward(saved.id, selectedAccountId)
      if (!tested.success) throw new Error('failed')
      setTestResult(tested.data)
    } catch (err) {
      setFailure(
        err instanceof ApiError && err.message && !/^API error/.test(err.message)
          ? err.message
          : '交換テストを実行できませんでした。時間をおいてもう一度お試しください。',
      )
    } finally {
      setTesting(false)
    }
  }

  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({
    dirty: JSON.stringify(form) !== baseline,
    busy: saving || testing,
  })

  if (state === 'loading') {
    return (
      <div data-design-node="L2Bzp">
        <ListState kind="loading" title="使い道を読み込んでいます" />
      </div>
    )
  }
  if (state === 'forbidden') {
    return (
      <div data-design-node="L2Bzp">
        <ListState kind="forbidden" title="使い道を編集する権限がありません" description="このLINEアカウントの使い道は、オーナーか管理者だけが扱えます。" />
      </div>
    )
  }
  if (state === 'error') {
    return (
      <div data-design-node="L2Bzp">
        <ListState kind="error" title="使い道を表示できませんでした" description="再読み込みしても直らない場合はエラー報告へ。" action={<Button onClick={() => void load()}>使い道を再読み込み</Button>} />
      </div>
    )
  }

  const published = reward?.status === 'published'
  const requestPublish = () => {
    setTouched(true)
    if (!selectedAccountId || errors.length > 0) return
    setPublishOpen(true)
  }
  const kindNote = KINDS.find((kind) => kind.value === form.rewardKind)?.note ?? ''
  const requiredMiles = Number(form.requiredMiles)
  const perFriend = form.perFriendLimit.trim() === '' ? '何回でも' : `${form.perFriendLimit}回まで`

  return (
    <div data-design-node="L2Bzp" className={formStyles.page}>
      <div className={formStyles.head}>
        <Link className={formStyles.back} href="/mileage?tab=rewards">← マイルへ</Link>
        <h1 className={formStyles.title}>使い道を作る</h1>
        <p className={formStyles.description}>マイルと交換できる特典を決めます。出ると、お客さまのLINE（マイルの画面）に並びます。</p>
      </div>

      {failure ? <Notice tone="danger" message={failure} /> : null}
      {testResult ? (
        <Notice tone={testResult.canDeliver ? 'success' : 'warn'}>
          {testResult.canDeliver
            ? `交換テストに合格しました。${formatNumber(testResult.requiredMiles)}マイルで受け渡せます。残高と在庫は動かしていません。`
            : `交換テストで確認が必要です。${testResult.warning ?? '受け渡す内容を確認してください'}。残高と在庫は動かしていません。`}
        </Notice>
      ) : null}
      {published ? (
        <Notice tone="info">
          いま出している内容はそのままです。保存すると下書きになり、「出す」を押すまでお客様の見え方は変わりません。
        </Notice>
      ) : null}

      <div className={formStyles.columns}>
        <div className={formStyles.main}>
          <section className={formStyles.card} aria-label="基本">
            <h2 className={formStyles.cardTitle}>基本</h2>
            <div className={formStyles.grid2}>
              <label className={formStyles.field}>
                <span className={formStyles.label}>名前 <span className={formStyles.required}>必須</span></span>
                <TextInput id="reward-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="例：送料無料クーポン" aria-label="名前" />
                {touched && !form.name.trim() ? <span className={formStyles.required}>使い道の名前を入力してください</span> : null}
              </label>
              <label className={formStyles.field}>
                <span className={formStyles.label}>必要マイル <span className={formStyles.required}>必須</span></span>
                <TextInput inputMode="numeric" value={form.requiredMiles} onChange={(e) => set('requiredMiles', e.target.value)} placeholder="例：500" aria-label="必要マイル" />
                {touched && errors.includes('必要マイルは1以上の整数で入力してください') ? <span className={formStyles.required}>必要マイルは1以上の整数で入力してください</span> : null}
              </label>
            </div>
            <details className={formStyles.details}>
              <summary>説明を添える（任意）</summary>
              <Field label="説明" htmlFor="reward-description-v8" note="一覧と交換の画面に出ます。空でも出せます">
                <TextArea id="reward-description-v8" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
              </Field>
            </details>
          </section>

          <section className={formStyles.card} aria-label="渡すもの">
            <h2 className={formStyles.cardTitle}>渡すもの</h2>
            <div className={formStyles.field}>
              <span className={formStyles.label}>渡すものの種類</span>
              <Select aria-label="渡すものの種類" size="full" value={form.rewardKind}
                onChange={(next) => set('rewardKind', next as MileageRewardKind)}
                options={KINDS.map((kind) => ({ value: kind.value, label: kind.label }))} />
              <details className={formStyles.details}>
                <summary>種類ごとの説明</summary>
              <RadioCardGroup legend="交換後に渡すもの" className={formStyles.grid2}>
                {KINDS.map((kind) => (
                  <RadioCard
                    key={kind.value}
                    name="reward-kind-v8"
                    value={kind.value}
                    checked={form.rewardKind === kind.value}
                    onChange={() => set('rewardKind', kind.value)}
                    title={kind.label}
                    note={kind.note}
                  />
                ))}
              </RadioCardGroup>
              </details>
              <span className={formStyles.hint}>{kindNote}</span>
            </div>
            <div className={formStyles.field}>
              <Field
                label="交換後に渡すもの"
                htmlFor="reward-action-v8"
                note={form.rewardKind === 'coupon'
                  ? 'クーポンは引換コードで渡すので、選ばなくても出せます'
                  : '共通アクションの版を指定します'}
                error={touched && errors.includes('交換後に渡すものを選んでください') ? '交換後に渡すものを選んでください' : undefined}
              >
                <Select
                  id="reward-action-v8"
                  aria-label="交換後に渡すもの"
                  size="full"
                  value={form.commonActionVersionId}
                  onChange={(next) => set('commonActionVersionId', next)}
                  options={[
                    { value: '', label: commonActionsFailed ? '公開版を読み込めませんでした' : '公開中の共通アクションを選ぶ' },
                    ...(form.commonActionVersionId && !commonActions.some((item) => item.id === form.commonActionVersionId)
                      ? [{ value: form.commonActionVersionId, label: '現在選択中の公開版' }]
                      : []),
                    ...commonActions.map((item) => ({ value: item.id, label: item.label })),
                  ]}
                  disabled={commonActionsFailed}
                />
              </Field>
            </div>
            <div className={formStyles.field}>
              <Field label="渡せなかったとき" htmlFor="reward-failure-v8" note="マイルは交換の時点で引かれます。渡せなかったときの決めごとがないと、引かれたまま何も届きません">
                <Select
                  id="reward-failure-v8"
                  aria-label="渡せなかったときにどうするか"
                  size="full"
                  value={form.failurePolicy}
                  onChange={(next) => set('failurePolicy', next as MileageRewardFailurePolicy)}
                  options={FAILURE_POLICIES.map((item) => ({ value: item.value, label: item.label }))}
                />
              </Field>
            </div>
            <details className={formStyles.details}>
              <summary>交換したときの案内（任意）</summary>
              <Field label="交換したときの案内" htmlFor="reward-message-v8" note="お客様に届く文です。空なら既定の文を送ります">
                <TextArea id="reward-message-v8" rows={2} value={form.customerMessage} onChange={(e) => set('customerMessage', e.target.value)} />
              </Field>
            </details>
          </section>

          <section className={formStyles.card} aria-label="だれが交換できるか">
            <h2 className={formStyles.cardTitle}>だれが交換できるか</h2>
            <label className={formStyles.field}>
              <span className={formStyles.label}>交換できる人</span>
              <Select
                aria-label="交換できる人"
                size="full"
                value={audience}
                onChange={(next) => {
                  const value = next as 'all' | 'conditioned'
                  setAudience(value)
                  if (value === 'all') set('targetConditions', null)
                }}
                options={[
                  { value: 'all', label: 'すべての友だち' },
                  { value: 'conditioned', label: '条件で絞る（タグ・会員ランクなど）' },
                ]}
              />
            </label>
            {audience === 'conditioned' ? (
              <div className={formStyles.conditionBox}>
                <ConditionBuilder
                  value={form.targetConditions}
                  onChange={(next) => set('targetConditions', next)}
                  label="交換対象の条件"
                />
              </div>
            ) : (
              <p className={formStyles.hint}>条件を付けない場合は全員が対象です。</p>
            )}
          </section>

          <section className={formStyles.card} aria-label="出す数と期間">
            <h2 className={formStyles.cardTitle}>出す数と期間</h2>
            <div className={formStyles.grid2}>
              <div className={formStyles.field}>
                <Field label="出す数" htmlFor="reward-stock-v8" note="空欄なら限りなし。0 と書くと品切れ（交換できません）" error={touched && errors.includes(LIMIT_FIELD_ERRORS.stockLimit) ? LIMIT_FIELD_ERRORS.stockLimit : undefined}>
                  <TextInput id="reward-stock-v8" inputMode="numeric" value={form.stockLimit} onChange={(e) => set('stockLimit', normalizeDigits(e.target.value))} placeholder="制限なし" />
                </Field>
              </div>
              <div className={formStyles.field}>
                <Field label="1人あたり" htmlFor="reward-per-friend-v8" note="空欄なら何回でも" error={touched && errors.includes(LIMIT_FIELD_ERRORS.perFriendLimit) ? LIMIT_FIELD_ERRORS.perFriendLimit : undefined}>
                  <TextInput id="reward-per-friend-v8" inputMode="numeric" value={form.perFriendLimit} onChange={(e) => set('perFriendLimit', normalizeDigits(e.target.value))} placeholder="1回まで" />
                </Field>
              </div>
            </div>
            <div className={formStyles.grid2}>
              <Field label="交換開始" htmlFor="reward-starts-v8" note="空欄ならいつでも" error={touched && errors.includes('交換終了は交換開始より後にしてください') ? '交換終了は交換開始より後にしてください' : undefined}>
                <DateTimeField id="reward-starts-v8" aria-label="交換開始" value={form.startsAt} onChange={(v) => set('startsAt', v)} />
              </Field>
              <Field label="交換終了" htmlFor="reward-ends-v8" note="空欄なら期限なし">
                <DateTimeField id="reward-ends-v8" aria-label="交換終了" value={form.endsAt} onChange={(v) => set('endsAt', v)} />
              </Field>
            </div>
            <div className={formStyles.field}>
              <Field label="交換後に使える日数" htmlFor="reward-expires-v8" note="空欄なら期限なし" error={touched && errors.includes(LIMIT_FIELD_ERRORS.benefitExpiresDays) ? LIMIT_FIELD_ERRORS.benefitExpiresDays : undefined}>
                <TextInput id="reward-expires-v8" inputMode="numeric" value={form.benefitExpiresDays} onChange={(e) => set('benefitExpiresDays', normalizeDigits(e.target.value))} placeholder="期限なし" />
              </Field>
            </div>
          </section>
        </div>

        <aside className={formStyles.aside}>
          <section className={formStyles.card} aria-label="お客さまの画面での見え方">
            <h2 className={formStyles.cardTitle}>お客さまの画面での見え方</h2>
            <p className={formStyles.hint}>LINEのマイルの画面</p>
            <div className={formStyles.trialRows}>
              <div className={formStyles.trialRow}>
                <dt>{form.name.trim() || '（名前を入力）'}</dt>
                <dd />
              </div>
              <div className={formStyles.trialRow}>
                <dt>{Number.isInteger(requiredMiles) && requiredMiles > 0 ? `${formatNumber(requiredMiles)} マイルで交換` : '—'}</dt>
                <dd />
              </div>
              <p className={formStyles.hint}>
                {form.benefitExpiresDays.trim() ? `交換後${form.benefitExpiresDays}日間` : '期限なし'}・お一人さま{perFriend}
              </p>
            </div>
          </section>

          <section className={formStyles.card} aria-label="出す前に">
            <h2 className={formStyles.cardTitle}>出す前に</h2>
            <Button onClick={() => void testExchange()} disabled={saving || testing} busy={testing} busyLabel="交換テスト中">
              自分で交換をテスト
            </Button>
            <p className={formStyles.hint}>残高と在庫は動きません。</p>
          </section>
        </aside>
      </div>

      <div className={formStyles.stickyBar}>
        <Button variant="secondary" href="/mileage?tab=rewards">キャンセル</Button>
        <Button onClick={() => void save(false)} disabled={saving || testing} busy={saving} busyLabel="保存中">
          下書きを保存
        </Button>
        <Button variant="primary" onClick={requestPublish} disabled={saving || testing}>
          <Check size={14} aria-hidden="true" /> 保存して出す
        </Button>
      </div>

      <ConfirmDialog
        open={publishOpen}
        title="この使い道を公開しますか？"
        description="公開すると、お客様がマイルを交換できるようになります。内容と必要マイルを確認してください。"
        confirmLabel="使い道を公開"
        busy={saving}
        error={failure || undefined}
        onCancel={() => setPublishOpen(false)}
        onConfirm={() => void save(true)}
      />
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した使い道" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}

export default function V8RewardEdit() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <RewardEditorInner />
    </Suspense>
  )
}

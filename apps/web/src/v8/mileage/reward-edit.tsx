'use client'

/*
 * ★V8 マイル「使い道を作る・編集する」（板 `L2Bzp`）。
 *
 * app/mileage/rewards/edit/v8-reward-edit.tsx から動きを写し、作る型（CreatePage）で組み直した。
 * 左に「基本・渡すもの・だれが交換できるか・出す数と期間」の段、右にお客さまの画面での
 * 見え方と出す前の交換テスト、下に追従の帯（キャンセル・下書きを保存・保存して出す）。
 * 欄は1つも落とさない。絵に無い欄（説明・交換したときの案内・交換後に使える日数・種類ごとの説明）は
 * 最後の「そのほか（任意）」の段にまとめ、欄の説明は「？」へ入れる。
 */
import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, ChevronLeft, FlaskConical, Plus } from 'lucide-react'
import { CreatePage } from '@/components/templates'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ConditionBuilder, { pruneCondition } from '@/components/shared/condition-builder'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import DateTimeField from '@/components/shared/date-time-field'
import { Field, OptionalBadge, TextArea, TextInput } from '@/components/shared/form-controls'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Select from '@/components/shared/select'
import { useAccount } from '@/contexts/account-context'
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
import { localDateTime, utcDateTime } from '@/lib/presentation'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { LIMIT_FIELD_ERRORS, normalizeDigits, optionalInteger, validateReward, type FormState } from './reward-form'
import styles from './reward-edit.module.css'

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

/** 選ぶ欄（絵：ラベルは 12px・入れ物との間 6）。説明は「？」へ。 */
function SelectField({ label, htmlFor, help, error, children }: { label: string; htmlFor: string; help?: string; error?: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <span className={styles.selectLabelRow}>
        <label htmlFor={htmlFor} className={styles.selectLabel}>{label}</label>
        {help ? <HelpTip label={`${label}の説明`}>{help}</HelpTip> : null}
      </span>
      {children}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  )
}

function RewardEditorInner() {
  usePageTitle('使い道を作る')
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
      const fallback = overview?.success ? overview.data.rewards.find((item) => item.id === rewardId) : undefined
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
      saved = await api.mileage.saveRewardDraft(rewardId, selectedAccountId, expectedVersionId, expectedRevision, draft)
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
    return <div data-design-node="L2Bzp"><ListState kind="loading" title="使い道を読み込んでいます" /></div>
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
  const errorOf = (message: string) => (touched && errors.includes(message) ? message : undefined)

  const preview = (
    <div className={styles.aside}>
      <section className={styles.sideCard} aria-label="お客さまの画面での見え方">
        <h2 className={styles.sideTitle}>お客さまの画面での見え方</h2>
        <p className={styles.sideNote}>LINE のマイルの画面</p>
        <div className={styles.phoneRow}>
          <span className={styles.phoneName}>{form.name.trim() || '（名前を入力）'}</span>
          <span className={styles.phoneMiles}>{Number.isInteger(requiredMiles) && requiredMiles > 0 ? `${formatNumber(requiredMiles)} マイルで交換` : '—'}</span>
          <span className={styles.phoneSub}>{`${form.benefitExpiresDays.trim() ? `交換後${form.benefitExpiresDays}日間` : '期限なし'}・お一人さま${perFriend}`}</span>
        </div>
      </section>
      <section className={styles.sideCard} aria-label="出す前に">
        <h2 className={styles.sideTitle}>出す前に</h2>
        <div>
          <Button onClick={() => void testExchange()} disabled={saving || testing} busy={testing} busyLabel="交換テスト中">
            <FlaskConical size={15} aria-hidden="true" /> 自分で交換をテスト
          </Button>
        </div>
        <p className={styles.sideNote}>残高と在庫は動きません。</p>
      </section>
    </div>
  )

  return (
    <CreatePage
      boardId="L2Bzp"
      title="使い道を作る"
      description="マイルと交換できる特典を決めます。出すと、お客さまの LINE（マイルの画面）に並びます。"
      identity={<Link href="/mileage?tab=rewards" className={styles.backLink}><ChevronLeft size={14} aria-hidden="true" />マイルへ</Link>}
      preview={preview}
      footerActions={<>
        <Button variant="secondary" href="/mileage?tab=rewards">キャンセル</Button>
        <Button onClick={() => void save(false)} disabled={saving || testing} busy={saving} busyLabel="保存中">
          下書きを保存
        </Button>
        <Button variant="primary" onClick={requestPublish} disabled={saving || testing}>
          <Check size={15} aria-hidden="true" /> 保存して出す
        </Button>
      </>}
    >
      {failure ? <Notice tone="danger" message={failure} /> : null}
      {testResult ? (
        <Notice tone={testResult.canDeliver ? 'success' : 'warn'}>
          {testResult.canDeliver
            ? `交換テストに合格しました。${formatNumber(testResult.requiredMiles)}マイルで受け渡せます。残高と在庫は動かしていません。`
            : `交換テストで確認が必要です。${testResult.warning ?? '受け渡す内容を確認してください'}。残高と在庫は動かしていません。`}
        </Notice>
      ) : null}
      {published ? (
        <Notice tone="info">いま出している内容はそのままです。保存すると下書きになり、「出す」を押すまでお客様の見え方は変わりません。</Notice>
      ) : null}

      <section className={styles.card} aria-label="基本">
        <h2 className={styles.cardTitle}>基本</h2>
        <div className={styles.grid2}>
          <Field label="名前" htmlFor="reward-name" error={touched && !form.name.trim() ? '使い道の名前を入力してください' : undefined}>
            <TextInput id="reward-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="例：送料無料クーポン" />
          </Field>
          <Field label="必要マイル" htmlFor="reward-miles" error={errorOf('必要マイルは1以上の整数で入力してください')}>
            <TextInput id="reward-miles" inputMode="numeric" value={form.requiredMiles} onChange={(e) => set('requiredMiles', e.target.value)} placeholder="例：500" />
          </Field>
        </div>
      </section>

      <section className={styles.card} aria-label="渡すもの">
        <h2 className={styles.cardTitle}>渡すもの</h2>
        <div className={styles.grid2}>
          <SelectField label="交換後に渡すもの" htmlFor="reward-action"
            help={form.rewardKind === 'coupon' ? 'クーポンは引換コードで渡すので、選ばなくても出せます' : '共通アクションの版を指定します'}
            error={errorOf('交換後に渡すものを選んでください')}
          >
            <Select
              id="reward-action"
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
          </SelectField>
          <SelectField label="渡すものの種類" htmlFor="reward-kind" help={kindNote}>
            <Select
              id="reward-kind"
              aria-label="渡すものの種類"
              size="full"
              value={form.rewardKind}
              onChange={(next) => set('rewardKind', next as MileageRewardKind)}
              options={KINDS.map((kind) => ({ value: kind.value, label: kind.label }))}
            />
          </SelectField>
        </div>
        <SelectField label="渡せなかったとき" htmlFor="reward-failure" help="マイルは交換の時点で引かれます。渡せなかったときの決めごとがないと、引かれたまま何も届きません">
          <Select
            id="reward-failure"
            aria-label="渡せなかったときにどうするか"
            size="full"
            value={form.failurePolicy}
            onChange={(next) => set('failurePolicy', next as MileageRewardFailurePolicy)}
            options={FAILURE_POLICIES.map((item) => ({ value: item.value, label: item.label }))}
          />
        </SelectField>
      </section>

      <section className={styles.card} aria-label="だれが交換できるか">
        <h2 className={styles.cardTitle}>だれが交換できるか</h2>
        <SelectField label="交換できる人" htmlFor="reward-audience">
          <Select
            id="reward-audience"
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
        </SelectField>
        {audience === 'conditioned' ? (
          <div className={styles.conditionBox}>
            <ConditionBuilder value={form.targetConditions} onChange={(next) => set('targetConditions', next)} label="交換対象の条件" />
          </div>
        ) : (
          <button type="button" className={styles.linkButton} onClick={() => setAudience('conditioned')}>
            <Plus size={13} aria-hidden="true" />条件を足す（タグ・会員ランクなど）
          </button>
        )}
      </section>

      <section className={styles.card} aria-label="出す数と期間">
        <h2 className={styles.cardTitle}>出す数と期間</h2>
        <div className={styles.grid2}>
          <div className={styles.field}>
            <label htmlFor="reward-stock" className={styles.label}>出す数<OptionalBadge /></label>
            <TextInput id="reward-stock" inputMode="numeric" title="空欄なら限りなし。0 と書くと品切れ（交換できません）" value={form.stockLimit} onChange={(e) => set('stockLimit', normalizeDigits(e.target.value))} placeholder="制限なし" />
            {errorOf(LIMIT_FIELD_ERRORS.stockLimit) ? <p className={styles.error} role="alert">{LIMIT_FIELD_ERRORS.stockLimit}</p> : null}
          </div>
          <div className={styles.field}>
            <label htmlFor="reward-per-friend" className={styles.label}>1人あたり<OptionalBadge /></label>
            <TextInput id="reward-per-friend" inputMode="numeric" title="空欄なら何回でも" value={form.perFriendLimit} onChange={(e) => set('perFriendLimit', normalizeDigits(e.target.value))} placeholder="1回まで" />
            {errorOf(LIMIT_FIELD_ERRORS.perFriendLimit) ? <p className={styles.error} role="alert">{LIMIT_FIELD_ERRORS.perFriendLimit}</p> : null}
          </div>
        </div>
        <div className={styles.grid2}>
          <div className={styles.field}>
            <label htmlFor="reward-starts" className={styles.label}>交換開始</label>
            <DateTimeField id="reward-starts" aria-label="交換開始" value={form.startsAt} onChange={(v) => set('startsAt', v)} />
            {errorOf('交換終了は交換開始より後にしてください') ? <p className={styles.error} role="alert">交換終了は交換開始より後にしてください</p> : null}
          </div>
          <div className={styles.field}>
            <label htmlFor="reward-ends" className={styles.label}>交換終了<OptionalBadge /></label>
            <DateTimeField id="reward-ends" aria-label="交換終了" value={form.endsAt} onChange={(v) => set('endsAt', v)} />
          </div>
        </div>
      </section>

      <section className={styles.card} aria-label="そのほか（任意）">
        <h2 className={styles.cardTitle}>そのほか（任意）</h2>
        <div className={styles.grid2}>
          <Field label="交換後に使える日数" htmlFor="reward-expires" help="空欄なら期限なし" error={errorOf(LIMIT_FIELD_ERRORS.benefitExpiresDays)}>
            <TextInput id="reward-expires" inputMode="numeric" value={form.benefitExpiresDays} onChange={(e) => set('benefitExpiresDays', normalizeDigits(e.target.value))} placeholder="期限なし" />
          </Field>
          <div />
        </div>
        <Field label="説明" htmlFor="reward-description" help="一覧と交換の画面に出ます。空でも出せます">
          <TextArea id="reward-description" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="交換したときの案内" htmlFor="reward-message" help="お客様に届く文です。空なら既定の文を送ります">
          <TextArea id="reward-message" rows={2} value={form.customerMessage} onChange={(e) => set('customerMessage', e.target.value)} />
        </Field>
        <RadioCardGroup legend="種類ごとの説明（選ぶと種類が変わります）" className={styles.grid2}>
          {KINDS.map((kind) => (
            <RadioCard
              key={kind.value}
              name="reward-kind-cards"
              value={kind.value}
              checked={form.rewardKind === kind.value}
              onChange={() => set('rewardKind', kind.value)}
              title={kind.label}
              note={kind.note}
            />
          ))}
        </RadioCardGroup>
      </section>

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
    </CreatePage>
  )
}

export default function RewardEditV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <RewardEditorInner />
    </Suspense>
  )
}

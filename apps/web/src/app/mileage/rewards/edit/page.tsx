'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Button from '@/components/shared/button'
import Card, { CardHeader } from '@/components/shared/card'
import { Field, TextArea, TextInput, inputClass } from '@/components/shared/form-controls'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Select from '@/components/shared/select'
import StickyBar from '@/components/shared/sticky-bar'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { validateReward, type FormState } from './reward-form'
import {
  api,
  ApiError,
  type MileageRewardDraftInput,
  type MileageRewardFailurePolicy,
  type MileageRewardKind,
  type MileageRewardSummary,
} from '@/lib/api'

/**
 * マイルの使い道をつくる・編集する（設計 `p9CcEB` 17-1-G）。
 *
 * **一覧（`qlVLJ`）から来て、ここで作って戻る。** 一覧に「使い道をつくる」を
 * 置けなかったのは、この面が無く行き止まりになるためだった。
 *
 * 出すのは Worker が受け取れるものだけ。**画面で選択肢を足さない**
 * ——選べるのに保存できない欄ができる。
 */

/**
 * 交換すると何が渡るか。**`MileageRewardKind` にあるものだけ。**
 * 設計には「回答フォームへ」「品もの」もあるが、**保存する口が無い**ので出さない。
 * 出すと、選べて押せて、保存で断られる。
 */
const KINDS: ReadonlyArray<{ value: MileageRewardKind; label: string; note: string }> = [
  { value: 'coupon', label: 'クーポンを渡す', note: '引換コードを配ります。交換後の動きを選ばなくても出せます' },
  { value: 'tag', label: 'タグを付ける', note: '付けたタグで、配信や絞り込みにつなげます' },
  { value: 'scenario', label: 'シナリオを始める', note: '交換した人だけに、続きの案内を流します' },
  { value: 'template', label: 'メッセージを送る', note: 'ひな形をそのまま1通送ります' },
  { value: 'early_access', label: '先にお知らせする', note: '一般より早く案内します' },
  { value: 'rank', label: 'ランクを上げる', note: 'ブロンズ・シルバーなどの段を上げます' },
]

/**
 * 渡せなかったときの決めごと。**「あとで直す」を既定にしない。**
 * 黙って消えるより、もう一度試すほうが取り返しがつく。
 */
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
    /* **`null` は「限りなし」なので空文字へ。0 は「0」のまま残す。** */
    stockLimit: version?.stockLimit == null ? '' : String(version.stockLimit),
    perFriendLimit: version?.perFriendLimit == null ? '' : String(version.perFriendLimit),
    startsAt: version?.startsAt?.slice(0, 16) ?? '',
    endsAt: version?.endsAt?.slice(0, 16) ?? '',
    benefitExpiresDays: version?.benefitExpiresDays == null ? '' : String(version.benefitExpiresDays),
    commonActionVersionId: version?.commonActionVersionId ?? '',
    failurePolicy: version?.failurePolicy ?? 'retry',
    customerMessage: version?.customerMessage ?? '',
  }
}

/** 空文字は `null`（限りなし・決めない）。**0 を null に潰さない。** */
function numberOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function draftOf(form: FormState): MileageRewardDraftInput {
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    rewardKind: form.rewardKind,
    requiredMiles: Number(form.requiredMiles),
    stockLimit: numberOrNull(form.stockLimit),
    perFriendLimit: numberOrNull(form.perFriendLimit),
    startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
    endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
    benefitExpiresDays: numberOrNull(form.benefitExpiresDays),
    commonActionVersionId: form.commonActionVersionId.trim() || null,
    failurePolicy: form.failurePolicy,
    customerMessage: form.customerMessage.trim(),
  }
}

function MileageRewardEditorInner() {
  const router = useRouter()
  const rewardId = useSearchParams().get('id')
  const editing = Boolean(rewardId)
  const { selectedAccountId } = useAccount()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [reward, setReward] = useState<MileageRewardSummary | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>(editing ? 'loading' : 'ready')
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState('')
  const [touched, setTouched] = useState(false)
  usePageTitle(editing ? '使い道を編集' : '使い道をつくる')

  const load = useCallback(async () => {
    if (!rewardId || !selectedAccountId) return
    setState('loading')
    try {
      const res = await api.mileage.reward(rewardId, selectedAccountId)
      if (!res.success) throw new Error('failed')
      setReward(res.data)
      setForm(formOf(res.data))
      setState('ready')
    } catch (err) {
      /* 権限不足は取得失敗と別。次にすることが違う。 */
      setState(err instanceof ApiError && err.status === 403 ? 'forbidden' : 'error')
    }
  }, [rewardId, selectedAccountId])

  useEffect(() => {
    if (!editing) { setState('ready'); return }
    void load()
  }, [editing, load])

  const errors = validateReward(form)
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((now) => ({ ...now, [key]: value }))
    setFailure('')
  }

  const save = async (thenPublish: boolean) => {
    setTouched(true)
    if (!selectedAccountId || errors.length > 0) return
    setSaving(true)
    setFailure('')
    try {
      const draft = draftOf(form)
      const saved = rewardId
        ? await api.mileage.saveRewardDraft(rewardId, selectedAccountId, draft)
        : await api.mileage.createReward(selectedAccountId, draft)
      if (!saved.success) throw new Error('failed')
      if (thenPublish) {
        const published = await api.mileage.publishReward(saved.data.id, selectedAccountId)
        if (!published.success) throw new Error('failed')
      }
      router.push('/mileage?tab=rewards')
    } catch (err) {
      /*
        **断りは、そのまま出してよいものだけ通す。** Worker は
        「使い道の種類を選んでください」のように運用者の言葉で返す。
        それ以外は言い換える。
      */
      setFailure(
        err instanceof ApiError && err.message && !/^API error/.test(err.message)
          ? err.message
          : '保存できませんでした。時間をおいてもう一度お試しください。',
      )
    } finally {
      setSaving(false)
    }
  }

  if (state === 'loading') return <ListState kind="loading" title="使い道を読み込んでいます" />
  if (state === 'forbidden') {
    return <ListState kind="forbidden" title="使い道を編集する権限がありません" description="このLINEアカウントの使い道は、オーナーか管理者だけが扱えます。" />
  }
  if (state === 'error') {
    return <ListState kind="error" title="使い道を表示できませんでした" description="再読み込みしても直らない場合はエラー報告へ。" action={<Button onClick={() => void load()}>使い道を再読み込み</Button>} />
  }

  const published = reward?.status === 'published'

  return (
    <div data-design-node="p9CcEB" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-ink-secondary text-xs">マイル / 使い道 / {editing ? '編集' : 'つくる'}</p>
        <Button href="/mileage?tab=rewards">使い道へ戻る</Button>
      </div>

      {failure ? <NoteBar tone="danger">{failure}</NoteBar> : null}
      {published ? (
        <NoteBar tone="info">
          {/* 画面に出る文なので、強調の記号を書かない（そのまま文字として出る）。 */}
          いま出している内容はそのままです。保存すると下書きになり、「出す」を押すまでお客様の見え方は変わりません。
        </NoteBar>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card padding="default">
          <CardHeader title="基本" />
          <Field label="使い道の名前" htmlFor="reward-name" required error={touched && !form.name.trim() ? '使い道の名前を入力してください' : undefined}>
            <TextInput id="reward-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="例：送料無料クーポン" />
          </Field>
          <Field label="説明" htmlFor="reward-description" note="一覧と交換の画面に出ます。空でも出せます">
            <TextArea id="reward-description" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field
            label="必要マイル"
            htmlFor="reward-miles"
            required
            error={touched && errors.includes('必要マイルは1以上の整数で入力してください') ? '必要マイルは1以上の整数で入力してください' : undefined}
          >
            <TextInput id="reward-miles" inputMode="numeric" value={form.requiredMiles} onChange={(e) => set('requiredMiles', e.target.value)} placeholder="例：1000" />
          </Field>
        </Card>

        <Card padding="default">
          <CardHeader title="渡すもの" />
          {/*
            **並べたタイルで選ぶ**（設計 `p9CcEB`）。選び口に畳むと、
            何が渡るのかを1つずつ開いて確かめることになる。
          */}
          <div role="radiogroup" aria-label="渡すもの" className="grid gap-2 sm:grid-cols-2">
            {KINDS.map((kind) => {
              const on = form.rewardKind === kind.value
              return (
                <button
                  key={kind.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set('rewardKind', kind.value)}
                  className={`rounded-control border p-3 text-left ${on ? 'border-accent bg-accent-soft' : 'border-hairline bg-canvas hover:bg-canvas-sunken'}`}
                >
                  <span className="text-ink block text-sm font-bold">{kind.label}</span>
                  <span className="text-ink-faint mt-0.5 block text-xs">{kind.note}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-4">
            <Field
              label="交換後に渡すもの"
              htmlFor="reward-action"
              required={form.rewardKind !== 'coupon'}
              note={form.rewardKind === 'coupon'
                ? 'クーポンは引換コードで渡すので、選ばなくても出せます'
                : '共通アクションの版を指定します'}
              error={touched && errors.includes('交換後に渡すものを選んでください') ? '交換後に渡すものを選んでください' : undefined}
            >
              <TextInput id="reward-action" value={form.commonActionVersionId} onChange={(e) => set('commonActionVersionId', e.target.value)} placeholder="共通アクションの版" />
            </Field>
          </div>
        </Card>

        <Card padding="default">
          <CardHeader title="出す数と期間" />
          {/*
            **「限りなし」と「品切れ」を混ぜない。** 空欄は限りなし、0 は品切れ。
            同じ見た目にすると、出したつもりのものが誰にも交換できない。
          */}
          <Field label="数の限り" htmlFor="reward-stock" note="空欄なら限りなし。0 と書くと品切れ（交換できません）">
            <TextInput id="reward-stock" inputMode="numeric" value={form.stockLimit} onChange={(e) => set('stockLimit', e.target.value)} placeholder="限りなし" />
          </Field>
          <Field label="1人あたりの上限" htmlFor="reward-per-friend" note="空欄なら何回でも">
            <TextInput id="reward-per-friend" inputMode="numeric" value={form.perFriendLimit} onChange={(e) => set('perFriendLimit', e.target.value)} placeholder="制限なし" />
          </Field>
          <Field label="交換できる期間" htmlFor="reward-starts" note="空欄ならいつでも" error={touched && errors.includes('交換終了は交換開始より後にしてください') ? '交換終了は交換開始より後にしてください' : undefined}>
            <div className="flex flex-wrap items-center gap-2">
              <input id="reward-starts" type="datetime-local" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} className={inputClass} />
              <span className="text-ink-faint text-xs">から</span>
              <input aria-label="交換終了" type="datetime-local" value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} className={inputClass} />
            </div>
          </Field>
          <Field label="交換後に使える日数" htmlFor="reward-expires" note="空欄なら期限なし">
            <TextInput id="reward-expires" inputMode="numeric" value={form.benefitExpiresDays} onChange={(e) => set('benefitExpiresDays', e.target.value)} placeholder="期限なし" />
          </Field>
        </Card>

        <Card padding="default">
          <CardHeader title="渡せなかったとき" />
          <Field label="どうするか" htmlFor="reward-failure" note="マイルは交換の時点で引かれます。渡せなかったときの決めごとがないと、引かれたまま何も届きません">
            <Select
              id="reward-failure"
              aria-label="渡せなかったときにどうするか"
              value={form.failurePolicy}
              onChange={(value) => set('failurePolicy', value as MileageRewardFailurePolicy)}
              options={FAILURE_POLICIES.map((item) => ({ value: item.value, label: item.label }))}
            />
          </Field>
          <Field label="交換したときの案内" htmlFor="reward-message" note="お客様に届く文です。空なら既定の文を送ります">
            <TextArea id="reward-message" rows={3} value={form.customerMessage} onChange={(e) => set('customerMessage', e.target.value)} />
          </Field>
        </Card>
      </div>

      <StickyBar
        status={editing ? (published ? '出している内容とは別に、下書きとして保存します' : '下書きです。出すまでお客様には見えません') : '下書きとして作ります'}
        actions={(
          <>
            <Button href="/mileage?tab=rewards">キャンセル</Button>
            <Button onClick={() => void save(false)} disabled={saving}>
              {saving ? '保存中' : '下書きを保存'}
            </Button>
            <Button variant="primary" onClick={() => void save(true)} disabled={saving}>
              保存して出す
            </Button>
          </>
        )}
      />
    </div>
  )
}

export default function MileageRewardEditorPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <MileageRewardEditorInner />
    </Suspense>
  )
}

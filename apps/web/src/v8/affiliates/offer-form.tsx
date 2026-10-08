'use client'

/*
 * 案件を作る・編集する窓（OfferFormModal）。app/affiliates/tabs.tsx から写した
 * （src/v8 は @/app を import できない）。決まり（受付期間・上限・数える期間）の欄は
 * offer-terms.tsx（同じく写し）を使う。動きは写し元と同じ。
 */
import { useCallback, useEffect, useId, useState } from 'react'
import type { LineAccount, Scenario, Tag } from '@line-crm/shared'
import { api, type AffiliateOffer } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import {
  EMPTY_TERMS,
  OfferTermsFields,
  parseOfferTermsInput,
  toDateInput,
  type OfferTermsFieldValues,
  type ParsedOfferTerms,
} from './offer-terms'

// ── Offer form modal ─────────────────────────────────────────────────────────

interface OfferFormProps {
  initial?: AffiliateOffer | null
  accounts: LineAccount[]
  tags: Tag[]
  scenarios: (Scenario & { stepCount?: number })[]
  onClose: () => void
  onSaved: () => void
}

export default function OfferFormModal({ initial, accounts, tags, scenarios, onClose, onSaved }: OfferFormProps) {
  const isEdit = Boolean(initial)
  // R286: 読み上げの項目名。見えている項目名と入力欄を htmlFor・id で結ぶ。
  const fieldId = useId()
  const nameId = `${fieldId}-name`
  const descriptionId = `${fieldId}-description`
  const rewardAmountId = `${fieldId}-reward-amount`
  const rewardMilesId = `${fieldId}-reward-miles`
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [rewardAmount, setRewardAmount] = useState(
    initial?.rewardAmount != null ? String(initial.rewardAmount) : '',
  )
  const [rewardMiles, setRewardMiles] = useState(
    initial?.rewardMiles != null ? String(initial.rewardMiles) : '',
  )
  const [lineAccountId, setLineAccountId] = useState(initial?.lineAccountId ?? '')
  const [tagId, setTagId] = useState(initial?.tagId ?? '')
  const [scenarioId, setScenarioId] = useState(initial?.scenarioId ?? '')
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // 決まりの欄（#823）。編集では今の版で埋める。読み込めるまでは
  // 差分に含めない（読み込めないまま保存して上限を消さないため）。
  const [terms, setTerms] = useState<OfferTermsFieldValues>(EMPTY_TERMS)
  const [termsBase, setTermsBase] = useState<ParsedOfferTerms | null>(null)
  const [termsLoaded, setTermsLoaded] = useState(!initial)
  /* WEB207：決まりの読み込みが失敗したことを黙らない。読み直せる。 */
  const [termsFailed, setTermsFailed] = useState(false)
  const [termsAttempt, setTermsAttempt] = useState(0)

  useEffect(() => {
    if (!initial) return
    let cancelled = false
    setTermsFailed(false)
    void api.affiliateOffers.capStatus(initial.id)
      .then((res) => {
        if (cancelled) return
        if (!res.success || !res.data) {
          setTermsLoaded(false)
          setTermsFailed(true)
          return
        }
        const version = res.data.version
        const base: ParsedOfferTerms = {
          windowDays: version?.windowDays ?? 30,
          capTotal: version?.capTotal ?? null,
          capMonthlyPerAffiliate: version?.capMonthlyPerAffiliate ?? null,
          receptionFrom: version?.receptionFrom ?? null,
          receptionTo: version?.receptionTo ?? null,
        }
        if (cancelled) return
        setTermsBase(base)
        setTerms({
          windowDays: String(base.windowDays ?? 30),
          capTotal: base.capTotal != null ? String(base.capTotal) : '',
          capMonthly: base.capMonthlyPerAffiliate != null ? String(base.capMonthlyPerAffiliate) : '',
          receptionFrom: toDateInput(base.receptionFrom),
          receptionTo: toDateInput(base.receptionTo),
        })
        setTermsLoaded(true)
      })
      .catch(() => {
        // 決まりが読めなくても、名前・報酬の編集はできる。決まりの差分は送らない。
        if (!cancelled) {
          setTermsLoaded(false)
          setTermsFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [initial, termsAttempt])

  // 選べるタグ・シナリオは「いま選んでいるLINEアカウントの有効なもの」だけに
  // 絞る（#798）。別アカウントのものを選ばせると保存時にサーバーが止める。
  // アカウント未選択のときは候補を出さない（先にアカウントを選ばせる）。
  // 既存案件に古い不正参照が残っているときは、選択中の値だけ別枠で見せて
  // 直せるようにする（黙って消すと保存のたびに参照が変わる）。
  const accountTags = tags.filter(
    (t) => lineAccountId !== '' && t.lineAccountId === lineAccountId && (t.status ?? 'active') === 'active',
  )
  const accountScenarios = scenarios.filter(
    (s) => lineAccountId !== '' && s.lineAccountId === lineAccountId && s.isActive !== false,
  )
  const tagIdStale = tagId !== '' && !accountTags.some((t) => t.id === tagId)
  const scenarioIdStale = scenarioId !== '' && !accountScenarios.some((s) => s.id === scenarioId)
  const staleTagName = tags.find((t) => t.id === tagId)?.name
  const staleScenarioName = scenarios.find((s) => s.id === scenarioId)?.name

  const handleSubmit = useCallback(async () => {
    if (submitting) return
    setFormError(null)
    if (!name.trim()) {
      setFormError('案件名は必須です')
      return
    }
    const reward =
      rewardAmount.trim() === ''
        ? undefined
        : Number(rewardAmount)
    if (reward !== undefined && (!Number.isInteger(reward) || reward < 0)) {
      setFormError('報酬額は0以上の整数で入力してください')
      return
    }
    const miles = rewardMiles.trim() === '' ? undefined : Number(rewardMiles)
    if (miles !== undefined && (!Number.isInteger(miles) || miles < 0)) {
      setFormError('付与マイルは0以上の整数で入力してください')
      return
    }
    // 決まりの欄（#823）。壊れた値は欄の下ではなく箱の誤りで見せる。
    const parsed = parseOfferTermsInput(terms)
    if (parsed.error) {
      setFormError(parsed.error)
      return
    }
    // 編集では変えた決まりだけ送る。変えていない保存で版を増やさない。
    // 読み込めなかったときは決まりを送らない（上限の消失を防ぐ）。
    const termsDiff: ParsedOfferTerms = {}
    if (isEdit && termsLoaded && termsBase) {
      if (parsed.terms.windowDays !== undefined && parsed.terms.windowDays !== termsBase.windowDays) {
        termsDiff.windowDays = parsed.terms.windowDays
      }
      if (parsed.terms.capTotal !== termsBase.capTotal) {
        termsDiff.capTotal = parsed.terms.capTotal
      }
      if (parsed.terms.capMonthlyPerAffiliate !== termsBase.capMonthlyPerAffiliate) {
        termsDiff.capMonthlyPerAffiliate = parsed.terms.capMonthlyPerAffiliate
      }
      if (parsed.terms.receptionFrom !== termsBase.receptionFrom) {
        termsDiff.receptionFrom = parsed.terms.receptionFrom
      }
      if (parsed.terms.receptionTo !== termsBase.receptionTo) {
        termsDiff.receptionTo = parsed.terms.receptionTo
      }
    }

    setSubmitting(true)
    try {
      if (isEdit && initial) {
        const res = await api.affiliateOffers.update(initial.id, {
          name: name.trim(),
          description: description.trim() || null,
          rewardAmount: reward,
          rewardMiles: miles,
          ...termsDiff,
          lineAccountId: lineAccountId || null,
          tagId: tagId || null,
          scenarioId: scenarioId || null,
          isActive,
        })
        if (!res.success) {
          // 失敗応答は非2xxで fetchApi が例外にするので、ここに来るのは
          // 2xx なのに success:false の形だけ。それでも文言があれば見せる。
          setFormError((res as { error?: string }).error ?? '更新に失敗しました。通信を確かめて、もう一度お試しください。')
          setSubmitting(false)
          return
        }
      } else {
        const res = await api.affiliateOffers.create({
          name: name.trim(),
          description: description.trim() || null,
          rewardAmount: reward,
          rewardMiles: miles,
          windowDays: parsed.terms.windowDays,
          capTotal: parsed.terms.capTotal,
          capMonthlyPerAffiliate: parsed.terms.capMonthlyPerAffiliate,
          receptionFrom: parsed.terms.receptionFrom,
          receptionTo: parsed.terms.receptionTo,
          lineAccountId: lineAccountId || null,
          tagId: tagId || null,
          scenarioId: scenarioId || null,
        })
        if (!res.success) {
          setFormError((res as { error?: string }).error ?? '作成に失敗しました。通信を確かめて、もう一度お試しください。')
          setSubmitting(false)
          return
        }
      }
      onSaved()
      onClose()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存に失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      setSubmitting(false)
    }
  }, [submitting, name, description, rewardAmount, rewardMiles, terms, termsLoaded, termsBase, lineAccountId, tagId, scenarioId, isActive, isEdit, initial, onSaved, onClose])

  return (
    <Dialog
      open
      title={isEdit ? '案件を編集' : '案件を新規作成'}
      busy={submitting}
      error={formError ?? undefined}
      confirmLabel={isEdit ? '更新' : '作成'}
      cancelLabel="キャンセル"
      onConfirm={() => { void handleSubmit() }}
      onCancel={onClose}
    >
      <div className="space-y-4">
        <div>
          <label htmlFor={nameId} className="text-ink-secondary mb-1 block text-xs font-medium">
            案件名 <span className="text-danger">*</span>
          </label>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 無料体験申込"
            className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor={descriptionId} className="text-ink-secondary mb-1 block text-xs font-medium">説明</label>
          <textarea
            id={descriptionId}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="案件の説明（任意）"
            className="border-hairline rounded-control bg-canvas text-ink w-full resize-none border px-3 py-2 text-sm focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor={rewardAmountId} className="text-ink-secondary mb-1 block text-xs font-medium">報酬額（円）</label>
          <input
            id={rewardAmountId}
            type="number"
            min="0"
            step="1"
            value={rewardAmount}
            onChange={(e) => setRewardAmount(e.target.value)}
            placeholder="例: 3000"
            className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor={rewardMilesId} className="text-ink-secondary mb-1 block text-xs font-medium">成果承認時の付与マイル</label>
          <input
            id={rewardMilesId}
            type="number"
            min="0"
            step="1"
            value={rewardMiles}
            onChange={(e) => setRewardMiles(e.target.value)}
            placeholder="例: 500"
            className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm focus:outline-none"
          />
          <p className="text-ink-faint mt-1 text-micro">承認された紹介1件ごとに紹介者へ付与します</p>
        </div>

        {isEdit && termsFailed ? (
          <p className="text-ink-secondary text-xs" role="status">
            数える期間・上限・受付の期間を読み込めませんでした。このまま保存しても、これらは変わりません。{' '}
            <button type="button" className="font-semibold underline" onClick={() => setTermsAttempt((n) => n + 1)}>読み直す</button>
          </p>
        ) : null}
        <OfferTermsFields values={terms} onChange={setTerms} disabled={isEdit && !termsLoaded} />

        <div>
          <label className="text-ink-secondary mb-1 block text-xs font-medium">誘導 LINE アカウント</label>
          <Select
            aria-label="誘導 LINE アカウント"
            value={lineAccountId}
            onChange={(value) => setLineAccountId(value)}
            options={[{ value: '', label: '— 選択しない —' }, ...accounts.map((acc) => ({ value: acc.id, label: acc.name }))]}
            className="w-full"
            size="full"
          />
        </div>

        <div>
          <label className="text-ink-secondary mb-1 block text-xs font-medium">タグ</label>
          <Select
            aria-label="タグ"
            value={tagId}
            onChange={(value) => setTagId(value)}
            options={[
              { value: '', label: '— 選択しない —' },
              ...accountTags.map((tag) => ({ value: tag.id, label: tag.name })),
              ...(tagIdStale ? [{ value: tagId, label: `${staleTagName ?? tagId}（このアカウントでは使えません）` }] : []),
            ]}
            className="w-full"
            size="full"
          />
        </div>

        <div>
          <label className="text-ink-secondary mb-1 block text-xs font-medium">シナリオ</label>
          <Select
            aria-label="シナリオ"
            value={scenarioId}
            onChange={(value) => setScenarioId(value)}
            options={[
              { value: '', label: '— 選択しない —' },
              ...accountScenarios.map((s) => ({ value: s.id, label: s.name })),
              ...(scenarioIdStale ? [{ value: scenarioId, label: `${staleScenarioName ?? scenarioId}（このアカウントでは使えません）` }] : []),
            ]}
            className="w-full"
            size="full"
          />
        </div>

        {isEdit && (
          <Toggle
            checked={isActive}
            onChange={setIsActive}
            label={isActive ? '有効' : '無効'}
          />
        )}
      </div>
    </Dialog>
  )
}

'use client'

/*
 * G-2 案件の決まり（#823）。報酬・数える期間・上限・受付の期間を、
 * 今の版と上限の残り・版の履歴と一緒に出す。保存するたびに版が増え、
 * 前の版は変わらない。
 */
import { useCallback, useEffect, useId, useState } from 'react'
import { api, type AffiliateOffer, type OfferCapStatus, type OfferVersion } from '@/lib/api'
import Dialog from '@/components/shared/dialog'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Progress from '@/components/shared/progress'
import { formatNumber } from '@/lib/format'

function formatReception(from: string | null, to: string | null): string {
  const date = (iso: string) => iso.slice(0, 10).replaceAll('-', '/')
  if (from && to) return `${date(from)}〜${date(to)}`
  if (from) return `${date(from)}〜`
  if (to) return `〜${date(to)}`
  return '期間なし'
}

function formatSavedAt(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ').replaceAll('-', '/')
}

function versionSummary(version: OfferVersion): string {
  const parts = [
    `1件 ${formatNumber(version.rewardAmount)}円`,
    version.rewardMiles > 0 ? `＋${formatNumber(version.rewardMiles)}マイル` : null,
    `期間${version.windowDays}日`,
    version.capTotal != null ? `全体${version.capTotal}件` : null,
    version.capMonthlyPerAffiliate != null ? `月${version.capMonthlyPerAffiliate}件` : null,
  ].filter((part): part is string => part !== null)
  return parts.join('・')
}

export interface OfferTermsFieldValues {
  windowDays: string
  capTotal: string
  capMonthly: string
  receptionFrom: string
  receptionTo: string
}

export const EMPTY_TERMS: OfferTermsFieldValues = {
  windowDays: '',
  capTotal: '',
  capMonthly: '',
  receptionFrom: '',
  receptionTo: '',
}

/** ISO（日時）→ 日付入力の形（YYYY-MM-DD）。空は空のまま。 */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = iso.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''
}

/** 日付入力の形 → ISO。from はその日の始め、to はその日の終わり。 */
export function fromDateInput(date: string, end: boolean): string | null {
  if (!date) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return end ? `${date}T23:59:59.000+09:00` : `${date}T00:00:00.000+09:00`
}

export interface ParsedOfferTerms {
  windowDays?: number
  capTotal?: number | null
  capMonthlyPerAffiliate?: number | null
  receptionFrom?: string | null
  receptionTo?: string | null
}

/**
 * 決まりの入力を確かめる。壊れた値は人の言葉の誤りで返す。
 * 空の上限・受付は「なし」(null)、空の期間は「変えない」(undefined)。
 */
export function parseOfferTermsInput(values: OfferTermsFieldValues): {
  terms: ParsedOfferTerms
  error: string | null
} {
  const terms: ParsedOfferTerms = {}
  if (values.windowDays.trim() !== '') {
    const windowDays = Number(values.windowDays)
    if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 365) {
      return { terms, error: '数える期間は1〜365日で入力してください' }
    }
    terms.windowDays = windowDays
  }
  for (const [key, label] of [
    ['capTotal', '全体の上限'],
    ['capMonthly', '1人あたり月の上限'],
  ] as const) {
    const raw = values[key].trim()
    if (raw === '') {
      terms[key === 'capTotal' ? 'capTotal' : 'capMonthlyPerAffiliate'] = null
    } else {
      const cap = Number(raw)
      if (!Number.isInteger(cap) || cap <= 0) {
        return { terms, error: `${label}は1以上の整数で入力してください。空にすると上限なしです` }
      }
      terms[key === 'capTotal' ? 'capTotal' : 'capMonthlyPerAffiliate'] = cap
    }
  }
  const from = values.receptionFrom ? fromDateInput(values.receptionFrom, false) : null
  const to = values.receptionTo ? fromDateInput(values.receptionTo, true) : null
  if (values.receptionFrom && !from) {
    return { terms, error: '受付の始めの日付が正しくありません' }
  }
  if (values.receptionTo && !to) {
    return { terms, error: '受付の終わりの日付が正しくありません' }
  }
  if (from && to && from > to) {
    return { terms, error: '受付の終わりは始めより後にしてください' }
  }
  terms.receptionFrom = from
  terms.receptionTo = to
  return { terms, error: null }
}

/** 案件の作成・編集に入れる決まりの欄。補足は「？」に入れ、箱を高くしない。 */
export function OfferTermsFields({
  values,
  onChange,
}: {
  values: OfferTermsFieldValues
  onChange: (next: OfferTermsFieldValues) => void
}) {
  // R286: 読み上げの項目名。「？」は項目名の外に置き、名前を短く保つ。
  const fieldId = useId()
  const windowDaysId = `${fieldId}-window-days`
  const capTotalId = `${fieldId}-cap-total`
  const capMonthlyId = `${fieldId}-cap-monthly`
  const receptionFromId = `${fieldId}-reception-from`
  const receptionToId = `${fieldId}-reception-to`
  return (
    <>
      <div>
        <span className="text-ink-secondary mb-1 flex items-center gap-1 text-xs font-medium">
          <label htmlFor={windowDaysId}>数える期間（日）</label>
          <HelpTip label="数える期間の説明">
            リンクを開いてから数える期間です。既定は30日です。
          </HelpTip>
        </span>
        <input
          id={windowDaysId}
          type="number"
          min="1"
          max="365"
          step="1"
          value={values.windowDays}
          onChange={(e) => onChange({ ...values, windowDays: e.target.value })}
          placeholder="例: 30（空は今のまま）"
          className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm focus:outline-none"
        />
      </div>

      <div>
        <span className="text-ink-secondary mb-1 flex items-center gap-1 text-xs font-medium">
          <label htmlFor={capTotalId}>全体の上限（件）</label>
          <HelpTip label="全体の上限の説明">
            この案件で付ける成果の数の上限です。上限に達したら受付を自動で止めます。
          </HelpTip>
        </span>
        <input
          id={capTotalId}
          type="number"
          min="1"
          step="1"
          value={values.capTotal}
          onChange={(e) => onChange({ ...values, capTotal: e.target.value })}
          placeholder="例: 200（空は上限なし）"
          className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm focus:outline-none"
        />
      </div>

      <div>
        <span className="text-ink-secondary mb-1 flex items-center gap-1 text-xs font-medium">
          <label htmlFor={capMonthlyId}>1人あたり月の上限（件）</label>
          <HelpTip label="1人あたり月の上限の説明">
            1人の紹介者に1か月で付ける数の上限です。上限に達したらその人の受付を止めます。
          </HelpTip>
        </span>
        <input
          id={capMonthlyId}
          type="number"
          min="1"
          step="1"
          value={values.capMonthly}
          onChange={(e) => onChange({ ...values, capMonthly: e.target.value })}
          placeholder="例: 10（空は上限なし）"
          className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={receptionFromId} className="text-ink-secondary mb-1 block text-xs font-medium">受付の始め</label>
          <input
            id={receptionFromId}
            type="date"
            value={values.receptionFrom}
            onChange={(e) => onChange({ ...values, receptionFrom: e.target.value })}
            className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor={receptionToId} className="text-ink-secondary mb-1 block text-xs font-medium">受付の終わり</label>
          <input
            id={receptionToId}
            type="date"
            value={values.receptionTo}
            onChange={(e) => onChange({ ...values, receptionTo: e.target.value })}
            className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm focus:outline-none"
          />
        </div>
      </div>
    </>
  )
}

export default function OfferTermsDialog({
  offer,
  onClose,
}: {
  offer: AffiliateOffer
  onClose: () => void
}) {
  const [status, setStatus] = useState<OfferCapStatus | null>(null)
  const [versions, setVersions] = useState<OfferVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const [statusRes, versionsRes] = await Promise.all([
        api.affiliateOffers.capStatus(offer.id),
        api.affiliateOffers.versions(offer.id),
      ])
      if (statusRes.success && versionsRes.success && Array.isArray(versionsRes.data)) {
        setStatus(statusRes.data)
        setVersions(versionsRes.data)
      } else {
        setFailed(true)
      }
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [offer.id])

  useEffect(() => {
    void load()
  }, [load])

  const version = status?.version ?? null
  const rewardAmount = version?.rewardAmount ?? offer.rewardAmount ?? 0
  const rewardMiles = version?.rewardMiles ?? offer.rewardMiles

  return (
    <Dialog open title={`決まり：${offer.name}`} onCancel={onClose}>
      {loading ? (
        <ListState kind="loading" title="決まりを読み込んでいます" />
      ) : failed || !status ? (
        <ListState
          kind="error"
          title="決まりを読み込めませんでした"
          description="通信を確かめて、もう一度お試しください。"
          onRetry={() => { void load() }}
        />
      ) : (
        <div className="space-y-4">
          {status.capped ? (
            <NoteBar tone="warn">上限に達したため、受付を止めています。新しい紹介には成果を付けません。</NoteBar>
          ) : null}
          <dl className="space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="text-ink-faint w-24 shrink-0">報酬</dt>
              <dd className="text-ink font-semibold tabular-nums">
                1件 {formatNumber(rewardAmount)}円
                {rewardMiles > 0 ? `＋${formatNumber(rewardMiles)}マイル` : null}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-faint flex w-24 shrink-0 items-center gap-1">
                数える期間
                <HelpTip label="数える期間の説明">
                  リンクを開いてから数える期間です。既定は30日です。
                </HelpTip>
              </dt>
              <dd className="text-ink tabular-nums">リンクを開いてから {version?.windowDays ?? 30}日</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-faint flex w-24 shrink-0 items-center gap-1">
                上限
                <HelpTip label="上限の説明">
                  案件全体と、1人あたり月の件数です。上限に達したら受付を自動で止めます。
                </HelpTip>
              </dt>
              <dd className="text-ink">
                {status.capTotal != null || status.capMonthlyPerAffiliate != null ? (
                  <>
                    {status.capTotal != null ? `この案件で${status.capTotal}件` : null}
                    {status.capTotal != null && status.capMonthlyPerAffiliate != null ? '／' : null}
                    {status.capMonthlyPerAffiliate != null ? `1人月${status.capMonthlyPerAffiliate}件` : null}
                  </>
                ) : (
                  '上限なし'
                )}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-faint w-24 shrink-0">受付</dt>
              <dd className="text-ink">{formatReception(version?.receptionFrom ?? null, version?.receptionTo ?? null)}</dd>
            </div>
          </dl>
          {status.capTotal != null ? (
            <Progress
              state="active"
              title={status.totalRemaining != null && status.totalRemaining > 0
                ? `上限まであと${status.totalRemaining}件`
                : '上限に達しました'}
              percent={Math.min(100, Math.round((status.totalUsed / status.capTotal) * 100))}
              countText={`${formatNumber(status.totalUsed)} / ${formatNumber(status.capTotal)}件`}
            />
          ) : status.capMonthlyPerAffiliate != null ? (
            <p className="text-ink-secondary text-sm tabular-nums">
              1人あたり月{status.capMonthlyPerAffiliate}件まで
            </p>
          ) : null}
          <section aria-label="決まりの履歴">
            <h3 className="text-ink text-xs font-semibold">決まりの履歴</h3>
            {versions.length === 0 ? (
              <p className="text-ink-faint mt-1 text-xs">まだ履歴がありません</p>
            ) : (
              <ul className="mt-1 space-y-1 text-xs">
                {versions.map((row) => (
                  <li key={row.id} className="text-ink-secondary">
                    <span className="text-ink font-medium tabular-nums">版{row.versionNumber}</span> {versionSummary(row)}
                    <span className="text-ink-faint">（{formatSavedAt(row.createdAt)}）</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Dialog>
  )
}

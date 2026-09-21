'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { Tag } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import BroadcastForm from '@/components/broadcasts/broadcast-form'
import Button from '@/components/shared/button'
import type { SegmentCondition } from '@/lib/segment-condition'
import type { BroadcastStepKey } from '@/components/broadcasts/broadcast-steps'

const BROADCAST_STEPS = new Set<BroadcastStepKey>(['basic', 'audience', 'message', 'schedule', 'confirm'])

/**
 * `?condition=<JSON>` から渡される絞り込み条件（IDEA-03）。
 * 友だち一覧の「この条件で配信を作成」が付ける。
 * 形が壊れているものは採用しない —— 壊れた条件を黙って全員扱いにすると
 * 誤配信になる。'invalid' を返して画面に理由を出す。
 */
const CONDITION_PARAM_MAX_LENGTH = 20000

function isSegmentConditionShape(value: unknown, depth = 0): value is SegmentCondition {
  if (depth > 4 || !value || typeof value !== 'object' || Array.isArray(value)) return false
  const condition = value as Record<string, unknown>
  if (condition.operator !== 'AND' && condition.operator !== 'OR') return false
  if (!Array.isArray(condition.rules)) return false
  for (const rule of condition.rules) {
    if (!rule || typeof rule !== 'object' || typeof (rule as { type?: unknown }).type !== 'string') {
      return false
    }
  }
  if (condition.groups !== undefined) {
    if (!Array.isArray(condition.groups)) return false
    if (!condition.groups.every((group: unknown) => isSegmentConditionShape(group, depth + 1))) {
      return false
    }
  }
  /*
   * ルールもグループも空の条件はサーバーで「全員一致」(1=1) に展開される。
   * 引き継ぎは必ず何かで絞るので、空の条件は壊れた値として採用しない。
   */
  if (depth === 0 && condition.rules.length === 0 && (!condition.groups || condition.groups.length === 0)) {
    return false
  }
  return true
}

function conditionParam(params: URLSearchParams): SegmentCondition | 'invalid' | null {
  const raw = params.get('condition')
  if (raw === null) return null
  if (raw.length === 0 || raw.length > CONDITION_PARAM_MAX_LENGTH) return 'invalid'
  try {
    const parsed: unknown = JSON.parse(raw)
    return isSegmentConditionShape(parsed) ? parsed : 'invalid'
  } catch {
    return 'invalid'
  }
}

function scoreRangeCondition(params: URLSearchParams): SegmentCondition | null {
  const parse = (key: 'scoreMin' | 'scoreMax') => {
    const raw = params.get(key)
    if (raw === null || !/^-?\d+$/.test(raw)) return null
    const value = Number(raw)
    return Number.isSafeInteger(value) ? value : null
  }
  const min = parse('scoreMin')
  const max = parse('scoreMax')
  if (min === null && max === null) return null
  if (min !== null && max !== null && min > max) return null
  return { operator: 'AND', rules: [{ type: 'score_range', value: { min, max } }] }
}

/**
 * 一斉配信の作成を、URL で開けるようにする。
 *
 * 中身は一覧で使っているフォームをそのまま出す。作成の中身を2つ持つと、
 * 片方だけ直したときに食い違う。
 */
/** 分析画面から渡された一時対象者。URL には ID だけを載せ、中身は API で読み直す。 */
interface AudienceHandoff {
  id: string
  sourceKind: string
  selectionKey: string | null
  memberCount: number
  expiresAt: string
}

/** 対象者がどの分析から来たかの見え方。selectionKey は集計の位置を運用者へ示す。 */
function audienceLabel(audience: AudienceHandoff): string {
  const source = audience.sourceKind === 'funnel' ? 'ファネル分析' : 'クロス集計'
  return audience.selectionKey ? `${source}「${audience.selectionKey}」` : `${source}の対象者`
}

function NewBroadcastPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const audienceId = searchParams.get('audienceId')?.trim() ?? ''
  const [audience, setAudience] = useState<AudienceHandoff | null>(null)
  const [audienceError, setAudienceError] = useState<'missing' | 'expired' | 'error' | null>(null)
  // 「対象者なしで続ける」を押した後、URL へ反映されるまでの間も待機へ戻らないよう持つ。
  const [audienceDismissed, setAudienceDismissed] = useState(false)
  const effectiveAudienceId = audienceDismissed ? '' : audienceId
  const audienceCondition: SegmentCondition | null = effectiveAudienceId
    ? { operator: 'AND', rules: [{ type: 'analytics_audience', value: { audienceId: effectiveAudienceId } }] }
    : null
  const urlSearch = new URLSearchParams(searchParams.toString())
  const handedCondition = conditionParam(urlSearch)
  const conditionParamInvalid = handedCondition === 'invalid'
  const initialCondition = audienceCondition
    ?? (handedCondition && handedCondition !== 'invalid' ? handedCondition : null)
    ?? scoreRangeCondition(urlSearch)
  const requestedStep = searchParams.get('step') as BroadcastStepKey | null
  const currentStep: BroadcastStepKey = requestedStep && BROADCAST_STEPS.has(requestedStep) ? requestedStep : 'basic'
  const scheduledDateParam = searchParams.get('scheduledDate') ?? ''
  const scheduledTimeParam = searchParams.get('scheduledTime') ?? '10:00'
  const initialScheduledDate = /^\d{4}-\d{2}-\d{2}$/.test(scheduledDateParam) ? scheduledDateParam : ''
  const initialScheduledTime = /^\d{2}:\d{2}$/.test(scheduledTimeParam) ? scheduledTimeParam : '10:00'

  const changeStep = (step: BroadcastStepKey) => {
    const next = new URLSearchParams(searchParams.toString())
    if (step === 'basic') next.delete('step')
    else next.set('step', step)
    router.replace(`/broadcasts/new${next.size ? `?${next.toString()}` : ''}`, { scroll: false })
  }

  const load = useCallback(async () => {
    try {
      const res = await api.tags.list()
      if (res.success) setTags(res.data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /*
   * URL の audienceId だけを頼りにせず、対象者の人数・期限をAPIへ読み直す。
   * アカウントを切り替えると対象者も別アカウントのものとして確かめ直す。
   * 遅れて届いた古い応答（切替前の結果）は捨てる。
   */
  useEffect(() => {
    setAudienceDismissed(false)
  }, [audienceId])

  useEffect(() => {
    if (!effectiveAudienceId || accountLoading || !selectedAccountId) {
      setAudience(null)
      setAudienceError(null)
      return
    }
    let cancelled = false
    setAudience(null)
    setAudienceError(null)
    api.analytics.audience(effectiveAudienceId, selectedAccountId)
      .then((res) => {
        if (cancelled) return
        if (res.success) setAudience(res.data)
        else setAudienceError('missing')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 410) setAudienceError('expired')
        else if (err instanceof ApiError && (err.status === 404 || err.status === 400)) setAudienceError('missing')
        else setAudienceError('error')
      })
    return () => {
      cancelled = true
    }
  }, [effectiveAudienceId, accountLoading, selectedAccountId])

  // アカウント未選択では対象者を確かめられない。スピナーで待たせず案内を出す。
  const audienceNoAccount = Boolean(effectiveAudienceId) && !accountLoading && !selectedAccountId
  const audiencePending = Boolean(effectiveAudienceId) && Boolean(selectedAccountId) && !audience && !audienceError

  return (
    <div>
      {loading || audiencePending || (effectiveAudienceId && accountLoading) ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : audienceNoAccount ? (
        <div className="bg-canvas rounded-card border-hairline border p-8 text-center">
          <p className="text-ink text-sm font-semibold">
            対象者を確認するには、先にLINE公式アカウントを選んでください。
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <Link href="/analytics" className="text-accent text-sm font-medium hover:underline">
              分析画面へ戻る
            </Link>
          </div>
        </div>
      ) : audienceError ? (
        <div className="bg-canvas rounded-card border-hairline border p-8 text-center">
          <p className="text-ink text-sm font-semibold">
            {audienceError === 'expired'
              ? 'この分析結果の対象者は24時間を過ぎました。もう一度集計してください。'
              : audienceError === 'error'
                ? '対象者の読み込みに失敗しました。通信状態を確かめてもう一度開いてください。'
                : '対象者が見つかりません。別のアカウントで作られたか、取り消されています。'}
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <Link href="/analytics" className="text-accent text-sm font-medium hover:underline">
              分析画面へ戻る
            </Link>
            <Button
              variant="secondary"
              onClick={() => {
                setAudienceDismissed(true)
                router.replace('/broadcasts/new')
              }}
            >
              対象者なしで作成を続ける
            </Button>
          </div>
        </div>
      ) : (
        <>
          {conditionParamInvalid ? (
            <p className="bg-canvas rounded-card border-hairline text-ink-secondary mb-3 border px-4 py-3 text-xs">
              引き継がれた絞り込み条件を読めませんでした。条件なしの作成画面を開いています。
            </p>
          ) : null}
          <BroadcastForm
            tags={tags}
          onSuccess={(broadcast) => router.push(
            broadcast.status === 'scheduled'
              ? `/broadcasts/reserved?id=${encodeURIComponent(broadcast.id)}`
              /*
               * 「今すぐ配信」はここで送らない。下書きとして保存したあと、
               * 送信ボタンのある詳細画面へ進める（IDEA-06: 保存と送信を
               * ひとつの操作に見せない）。
               */
              : `/broadcasts?id=${encodeURIComponent(broadcast.id)}`,
          )}
          onCancel={() => router.push('/broadcasts')}
          openTemplatePickerInitially={searchParams.get('templatePicker') === '1'}
          initialTemplateId={searchParams.get('templateId')}
          initialContentTemplateId={searchParams.get('contentTemplateId')}
          initialCondition={initialCondition}
          audienceNotice={audience ? { ...audience, label: audienceLabel(audience) } : null}
          initialScheduledDate={initialScheduledDate}
          initialScheduledTime={initialScheduledTime}
          currentStep={currentStep}
          onStepChange={changeStep}
          visualQaAugustCampaign={searchParams.get('visualQa') === 'august-campaign'}
        />
        </>
      )}
    </div>
  )
}

export default function NewBroadcastPage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <NewBroadcastPageContent />
    </Suspense>
  )
}

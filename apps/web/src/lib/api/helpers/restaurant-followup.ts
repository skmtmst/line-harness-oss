import { fetchApi } from '../transport/request'
import { ApiError } from '../transport/errors'
import { scenariosMethods } from '../features/scenarios'
import type {
  ApiResponse,
  BroadcastBubble,
  RestaurantFollowupBinding,
  RestaurantFollowupPage,
  RestaurantFollowupTrigger,
  ScenarioStep,
} from '@line-crm/shared'

export type { RestaurantFollowupBinding, RestaurantFollowupPage, RestaurantFollowupTrigger, ScenarioStep }

/*
 * ★V8 飲食の LINE来店フォロー（本番接続）。共通の型は parcels/shared。
 *
 * 版はすべて「テンプレートの版」（template.template_version）。
 * 本文の PUT も結びの POST/PATCH も、同じ版を expectedVersion に入れる。
 */

/** 行の今の状態。 */
export type FollowupStepState = 'sending' | 'ready' | 'stopped'

/** 画面の1行分。本文はシナリオ（本体）の一歩から読む。 */
export interface FollowupStepLive {
  trigger: RestaurantFollowupTrigger
  binding: RestaurantFollowupBinding | null
  step: ScenarioStep | null
  bubbles: BroadcastBubble[]
  offsetMinutes: number | null
  state: FollowupStepState
}

/** 画面が読む1店舗分。 */
export interface FollowupLive {
  storeId: string
  storeName: string
  scenarioId: string
  templateVersion: number
  sendingStatus: string
  approvalId: string | null
  steps: FollowupStepLive[]
  reviewInvitations: number | null
}

const base = (storeId: string) => `/api/restaurant-test/followups/${encodeURIComponent(storeId)}`

function unwrap<T>(response: ApiResponse<T>, fallback: string): T {
  if (!response.success) throw new Error(response.error || fallback)
  return response.data
}

/*
 * 1店舗分を読む。まだ無い店舗（404）は null を返し、画面は7行の見本を出す。
 * 読めない数は 0 や作り話で埋めない（共通の決まり）。
 */
export async function fetchRestaurantFollowup(storeId: string, storeName = ''): Promise<FollowupLive | null> {
  let page: RestaurantFollowupPage
  try {
    page = unwrap(await fetchApi<ApiResponse<RestaurantFollowupPage>>(base(storeId)), 'フォローの設定を読み込めませんでした')
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
  const scenario = unwrap(
    await scenariosMethods.scenarios.get(page.template.scenario_id),
    'シナリオを読み込めませんでした',
  )
  const byId = new Map(scenario.steps.map(step => [step.id, step]))
  const sending = page.template.sending_status === 'active'
  const triggers: RestaurantFollowupTrigger[] = [
    'reservation_created', 'reservation_24h', 'reservation_2h', 'post_visit',
    'review_request', 'waitlist_invited', 'anniversary_before',
  ]
  const steps: FollowupStepLive[] = triggers.map(trigger => {
    const binding = page.bindings.find(item => item.trigger === trigger) ?? null
    const step = binding ? byId.get(binding.step_id) ?? null : null
    const bubbles = step?.messageBubbles ?? []
    const enabled = binding?.enabled === 1
    return {
      trigger,
      binding,
      step,
      bubbles,
      offsetMinutes: binding?.offset_minutes ?? null,
      state: !enabled ? 'stopped' : sending ? 'sending' : 'ready',
    }
  })
  return {
    storeId,
    storeName,
    scenarioId: page.template.scenario_id,
    templateVersion: page.template.template_version,
    sendingStatus: page.template.sending_status,
    approvalId: page.template.approval_id,
    steps,
    reviewInvitations: null,
  }
}

/** 行の本文（吹き出し1〜5個）を版付きで保存する。 */
export function saveFollowupMessages(storeId: string, stepId: string, input: { expectedVersion: number; messageBubbles: BroadcastBubble[] }) {
  return fetchApi<ApiResponse<{ stepId: string; messageBubbles: BroadcastBubble[]; version: number; sendingStatus: string }>>(
    `${base(storeId)}/steps/${encodeURIComponent(stepId)}/messages`,
    { method: 'PUT', body: JSON.stringify(input) },
  )
}

/*
 * きっかけ・時期・オン/オフを保存する（4項目とも必須）。
 * 結びがある行は PATCH、無い行は POST。POST は本体の一歩が無いと 409 になる
 * （本体の自動作成の口が無い。口の一覧の2件目）。
 */
export function saveFollowupBinding(storeId: string, stepId: string, method: 'POST' | 'PATCH', input: {
  expectedVersion: number; trigger: RestaurantFollowupTrigger; offsetMinutes: number; enabled: boolean
}) {
  return fetchApi<ApiResponse<{ stopped: boolean }>>(
    `${base(storeId)}/bindings/${encodeURIComponent(stepId)}`,
    { method, body: JSON.stringify(input) },
  )
}

/** 本送信の承認を申請する。有効な結びが1つ以上要る。 */
export function requestFollowupStart(storeId: string, expectedVersion: number) {
  return fetchApi<ApiResponse<{ approvalId: string; sendingStatus: string }>>(
    `${base(storeId)}/request-start`,
    { method: 'POST', body: JSON.stringify({ expectedVersion }) },
  )
}

/** 本送信を止める。 */
export function stopFollowup(storeId: string) {
  return fetchApi<ApiResponse<{ sendingStatus: string }>>(`${base(storeId)}/stop`, { method: 'POST' })
}

/** 口コミ依頼の送信履歴の1行。 */
export interface FollowupInvitation {
  source_job_id: string
  reservation_id: string
  status: string
  scheduled_at: string
  message_log_id: string | null
  sent_at: string | null
  content: string | null
}

/** 口コミ依頼の送信履歴を読む。 */
export async function fetchFollowupReviewHistory(storeId: string): Promise<FollowupInvitation[]> {
  const data = unwrap(
    await fetchApi<ApiResponse<{ invitations: FollowupInvitation[] }>>(`${base(storeId)}/review-history`),
    '送信履歴を読み込めませんでした',
  )
  return data.invitations
}

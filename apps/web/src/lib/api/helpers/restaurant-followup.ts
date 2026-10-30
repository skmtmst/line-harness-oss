import { fetchApi } from '../transport/request'
import { ApiError } from '../transport/errors'
import { scenariosMethods } from '../features/scenarios'
import type {
  ApiResponse,
  BroadcastBubble,
  RestaurantFollowupBinding,
  RestaurantFollowupPage,
  RestaurantFollowupRow,
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
  row?: RestaurantFollowupRow
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
  scenarioId: string | null
  templateVersion: number | null
  sendingStatus: string
  approvalId: string | null
  steps: FollowupStepLive[]
  reviewInvitations: number | null
}

const base = (storeId: string) => `/api/restaurant-test/followups/${encodeURIComponent(storeId)}`
const withAccount = (path: string, accountId: string) => `${path}?account_id=${encodeURIComponent(accountId)}`

function unwrap<T>(response: ApiResponse<T>, fallback: string): T {
  if (!response.success) throw new Error(response.error || fallback)
  return response.data
}

/*
 * 一歩の送る中身。吹き出しがあればそれを、無ければ旧来のテキスト1通を1通の吹き出しに読み替える。
 * 旧来のテキスト以外（画像など）はこの画面では扱わない。
 */
export function stepBubbles(step: ScenarioStep): BroadcastBubble[] {
  if (step.messageBubbles?.length) return step.messageBubbles
  if (step.messageType === 'text' && step.messageContent.trim()) {
    return [{ id: `${step.id}-text`, type: 'text', content: { text: step.messageContent } }]
  }
  return []
}

/*
 * この画面で直せない本文。吹き出しが無く、旧来の形もテキスト以外（画像など）。
 * 空欄に見せて上書きしないよう、編集を止める。本体では直せる（吹き出しが無いため本体の guard に掛からない）。
 */
export function isUnsupportedBody(step: ScenarioStep | null): boolean {
  return step !== null && !(step.messageBubbles?.length) && step.messageType !== 'text'
}

/*
 * 1店舗分を読む。まだ無い店舗（404）は null を返し、画面は7行の見本を出す。
 * 読めない数は 0 や作り話で埋めない（共通の決まり）。
 */
export async function fetchRestaurantFollowup(accountId: string, storeId: string, storeName = ''): Promise<FollowupLive | null> {
  let page: RestaurantFollowupPage
  try {
    page = unwrap(await fetchApi<ApiResponse<RestaurantFollowupPage>>(withAccount(base(storeId), accountId)), 'フォローの設定を読み込めませんでした')
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
  const scenario = page.template ? unwrap(
    await scenariosMethods.scenarios.get(page.template.scenario_id),
    'シナリオを読み込めませんでした',
  ) : null
  const byId = new Map((scenario?.steps ?? []).map(step => [step.id, step]))
  const sending = page.template?.sending_status === 'active'
  const triggers: RestaurantFollowupTrigger[] = [
    'reservation_created', 'reservation_24h', 'reservation_2h', 'post_visit',
    'review_request', 'waitlist_invited', 'anniversary_before',
  ]
  const steps: FollowupStepLive[] = triggers.map(trigger => {
    const row = page.rows?.find(item => item.trigger === trigger)
    const binding = page.bindings.find(item => item.trigger === trigger && (!row?.step_id || item.step_id === row.step_id)) ?? null
    const step = binding ? byId.get(binding.step_id) ?? null : null
    const bubbles: BroadcastBubble[] = step ? stepBubbles(step) : row ? [{ id: `initial-${trigger}`, type: 'text', content: { text: row.initial_message } }] : []
    const enabled = binding?.enabled === 1
    return {
      trigger,
      row,
      binding,
      step,
      bubbles,
      offsetMinutes: binding?.offset_minutes ?? row?.default_offset_minutes ?? null,
      state: !enabled ? 'stopped' : sending ? 'sending' : 'ready',
    }
  })
  return {
    storeId,
    storeName,
    scenarioId: page.template?.scenario_id ?? null,
    templateVersion: page.template?.template_version ?? null,
    sendingStatus: page.template?.sending_status ?? 'stopped',
    approvalId: page.template?.approval_id ?? null,
    steps,
    reviewInvitations: null,
  }
}

/** 行の本文（吹き出し1〜5個）を版付きで保存する。 */
export function saveFollowupMessages(accountId: string, storeId: string, stepId: string, input: { expectedVersion: number; messageBubbles: BroadcastBubble[] }) {
  return fetchApi<ApiResponse<{ stepId: string; messageBubbles: BroadcastBubble[]; version: number; sendingStatus: string }>>(
    withAccount(`${base(storeId)}/steps/${encodeURIComponent(stepId)}/messages`, accountId),
    { method: 'PUT', body: JSON.stringify(input) },
  )
}

/*
 * きっかけ・時期・オン/オフを保存する（4項目とも必須）。
 * 結びがある行は PATCH、無い行は POST。POST は本体の一歩が無いと 409 になる
 * （本体の自動作成の口が無い。口の一覧の2件目）。
 */
export function saveFollowupBinding(accountId: string, storeId: string, stepId: string, method: 'POST' | 'PATCH', input: {
  expectedVersion: number; trigger: RestaurantFollowupTrigger; offsetMinutes: number; enabled: boolean
}) {
  return fetchApi<ApiResponse<{ stopped: boolean }>>(
    withAccount(`${base(storeId)}/bindings/${encodeURIComponent(stepId)}`, accountId),
    { method, body: JSON.stringify(input) },
  )
}

/*
 * 本体のシナリオの下書きを公開版として固定する。申請は公開版を対象にするため、
 * 申請の直前に呼んで画面の本文と承認対象の一致を保つ。キーは押すたびに新しくする。
 */
export function publishFollowupScenario(scenarioId: string) {
  return fetchApi<ApiResponse<{ scenarioId: string; versionId: string; versionNumber: number; publishedAt: string }>>(
    `/api/scenarios/${encodeURIComponent(scenarioId)}/publish`,
    { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({}) },
  )
}

/** 本送信の承認を申請する。有効な結びが1つ以上要る。 */
export function requestFollowupStart(accountId: string, storeId: string, expectedVersion: number) {
  return fetchApi<ApiResponse<{ approvalId: string; sendingStatus: string }>>(
    withAccount(`${base(storeId)}/request-start`, accountId),
    { method: 'POST', body: JSON.stringify({ expectedVersion }) },
  )
}

/** 本送信を止める。 */
export function stopFollowup(accountId: string, storeId: string) {
  return fetchApi<ApiResponse<{ sendingStatus: string }>>(withAccount(`${base(storeId)}/stop`, accountId), { method: 'POST' })
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
export async function fetchFollowupReviewHistory(accountId: string, storeId: string): Promise<FollowupInvitation[]> {
  const data = unwrap(
    await fetchApi<ApiResponse<{ invitations: FollowupInvitation[] }>>(withAccount(`${base(storeId)}/review-history`, accountId)),
    '送信履歴を読み込めませんでした',
  )
  return data.invitations
}

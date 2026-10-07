/*
 * ★V8 LINEアカウントを登録の、画面に依らない小さな計算。
 * src/v8 からは @/app を読めないので、今の登録（app/accounts/connection-check-view.ts・
 * app/accounts/new/account-recovery.ts・app/accounts/new/register-v8.tsx）から写した。
 * 中身・判定は同じ。片方を直したらもう片方も同じに直す。
 */
import type { LineAccountConnectData, LineAccountConnectVerification } from '@/lib/api'

export type CheckState = 'passed' | 'failed' | 'skipped'
export interface CheckStep { order: number; message: string; state: CheckState }

/** 返事を設計の5段に並べ直す。返事が無ければ5段とも「確かめていません」。 */
export function toSteps(result: { steps: CheckStep[] } | null): CheckStep[] {
  const messages = [
    'チャネルIDとシークレットでアクセストークンを発行',
    '公式アカウントの名前とアイコンを取得',
    'Webhook URLを登録して、実際に届くかテスト',
    'LINE Loginチャネルを確認して、LIFFアプリを作成',
    '認証済みアカウントかを判定',
  ]
  if (!result) return messages.map((message, i) => ({ order: i + 1, message, state: 'skipped' as const }))
  return result.steps.map((item) => ({ ...item }))
}

/** 保存してよいか。5段すべて通ったときだけ保存する。 */
export function canSave(steps: CheckStep[]): boolean {
  return steps.every((s) => s.state === 'passed')
}

/** R523: 同じチャネルIDで作られた行が1件だけなら、その ID。 */
export function matchRegisteredAccountId(accounts: Array<{ id: string; channelId: string }>, channelId: string): string | null {
  const want = channelId.trim()
  if (!want) return null
  const found = accounts.filter((account) => account.channelId === want)
  return found.length === 1 ? found[0].id : null
}

/** サーバの重複エラーの目印（英語のまま返ることがある）。 */
export function isDuplicateChannelError(message: string): boolean {
  return /already registered|UNIQUE constraint/i.test(message)
}

export type CheckRowState = 'passed' | 'failed' | 'todo'
export interface V8CheckRow {
  key: 'channel' | 'provider' | 'webhook' | 'lineId' | 'addUrl'
  title: string
  detail: string
  state: CheckRowState
  message: string | null
}

export function webhookDetail(webhook: LineAccountConnectVerification['webhook'] | undefined, checked: boolean, passed: boolean): string {
  if (!checked) return '「接続して設定する」を押すと確かめます'
  if (passed) return 'musubo の受け口へ届きました'
  if (webhook && webhook.registeredUrl !== null && webhook.registeredUrl !== webhook.expectedUrl) return '登録先が musubo の受け口と違います'
  if (webhook && webhook.active === false) return 'LINE Developers で「Webhook の利用」がオフです。オンにしてから押し直してください'
  return '受け口へ届きませんでした'
}

/** ④の5行。検査前はすべて「まだ」。内訳（verification）が無い古い応答は5段の合否から作る。 */
export function toV8CheckRows(connection: LineAccountConnectData | null): V8CheckRow[] {
  const steps = toSteps(connection ? { steps: connection.steps } : null)
  const verification = connection?.verification
  const webhookChecked = Boolean(connection) && steps[2] !== undefined && steps[2].state !== 'skipped'
  const webhookPassed = Boolean(connection) && steps[2]?.state === 'passed'
  const channelPassed = verification ? verification.tokenOk && verification.loginOk : steps[0]?.state === 'passed' && steps[3]?.state === 'passed'
  const channelFailed = Boolean(connection) && !channelPassed && (steps[0]?.state === 'failed' || steps[3]?.state === 'failed')
  const providerPassed = verification ? verification.sameProvider : channelPassed
  const providerFailed = Boolean(connection) && !providerPassed && (steps[0]?.state === 'failed' || steps[3]?.state === 'failed')
  const basicId = connection?.basicId ?? null
  const lineIdState: CheckRowState = connection && webhookPassed && basicId ? 'passed' : 'todo'
  const addUrlState: CheckRowState = connection && webhookPassed && basicId ? 'passed' : 'todo'
  return [
    {
      key: 'channel', title: 'チャネル ID とシークレット', detail: 'Messaging API・LINE Login とも認証済み',
      state: !connection ? 'todo' : channelPassed ? 'passed' : channelFailed ? 'failed' : 'todo',
      message: channelFailed ? (steps[0]?.state === 'failed' ? steps[0].message : steps[3]?.message ?? null) : null,
    },
    {
      key: 'provider', title: '同じプロバイダー', detail: '2つのチャネルが同じプロバイダーにある',
      state: !connection ? 'todo' : providerPassed ? 'passed' : providerFailed ? 'failed' : 'todo',
      message: providerFailed ? 'チャネルID・シークレットを確認してください。' : null,
    },
    {
      key: 'webhook', title: 'Webhook', detail: webhookDetail(verification?.webhook, webhookChecked, webhookPassed),
      state: !connection || !webhookChecked ? 'todo' : webhookPassed ? 'passed' : 'failed',
      message: !connection || !webhookChecked || webhookPassed ? null : (steps[2]?.message ?? null),
    },
    { key: 'lineId', title: 'LINE ID の取得', detail: lineIdState === 'passed' && basicId ? basicId : '3 が通ると確かめます', state: lineIdState, message: null },
    { key: 'addUrl', title: '友だち追加 URL', detail: addUrlState === 'passed' && basicId ? `https://lin.ee/${basicId.replace(/^@/, '')}` : '3 が通ると確かめます', state: addUrlState, message: null },
  ]
}

export function allV8RowsPassed(rows: V8CheckRow[]): boolean {
  return rows.every((row) => row.state === 'passed')
}

/** 友だち数の統計は前日分。日本時間の昨日を yyyyMMdd で返す。 */
export function insightDateJst(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000)
  return `${jst.getUTCFullYear()}${String(jst.getUTCMonth() + 1).padStart(2, '0')}${String(jst.getUTCDate()).padStart(2, '0')}`
}

export const DRAFT_KEY = 'musubo-register-draft-v8'
export type StepNumber = 1 | 2 | 3 | 4 | 5
export interface DraftState {
  step: StepNumber
  accountMethod: 'existing' | 'new'
  name: string; channelId: string; loginChannelId: string; lineId: string
  tagIds: string[]; parentId: string; staffIds: string[]; liffId: string; importFriends: boolean
}

/** 端末の下書き（秘密値は書かない）。今の登録と同じ名前・同じ形。 */
export function readDraft(storage: Pick<Storage, 'getItem'>): DraftState | null {
  try {
    const raw = storage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DraftState>
    if (parsed.step !== 1 && parsed.step !== 2 && parsed.step !== 3 && parsed.step !== 4) return null
    const text = (value: unknown) => typeof value === 'string' ? value : ''
    const ids = (value: unknown) => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
    const draft: DraftState = {
      step: parsed.step, accountMethod: parsed.accountMethod === 'new' ? 'new' : 'existing',
      name: text(parsed.name), channelId: text(parsed.channelId), loginChannelId: text(parsed.loginChannelId), lineId: text(parsed.lineId),
      tagIds: ids(parsed.tagIds), parentId: text(parsed.parentId), staffIds: ids(parsed.staffIds), liffId: text(parsed.liffId),
      importFriends: parsed.importFriends !== false,
    }
    // 手順1のまま何も入れていない下書きは戻さない（画面を開き直しただけで「下書きから続けます」を出さない）。
    const empty = draft.step === 1 && draft.accountMethod === 'existing' && !draft.name && !draft.channelId && !draft.loginChannelId
      && !draft.lineId && draft.tagIds.length === 0 && !draft.parentId && draft.staffIds.length === 0 && !draft.liffId
    return empty ? null : draft
  } catch {
    return null
  }
}

export interface ChannelFields { channelId: string; channelSecret: string; loginChannelId: string; loginChannelSecret: string }
export function channelErrors(form: ChannelFields): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!form.channelId.trim()) errors.channelId = 'チャネルIDを入力してください。'
  else if (!/^\d+$/.test(form.channelId.trim())) errors.channelId = 'チャネルIDは半角数字で入力してください。'
  if (!form.channelSecret) errors.channelSecret = 'チャネルシークレットを入力してください。'
  if (!form.loginChannelId.trim()) errors.loginChannelId = 'LoginチャネルIDを入力してください。'
  else if (!/^\d+$/.test(form.loginChannelId.trim())) errors.loginChannelId = 'LoginチャネルIDは半角数字で入力してください。'
  if (!form.loginChannelSecret) errors.loginChannelSecret = 'Loginチャネルシークレットを入力してください。'
  return errors
}

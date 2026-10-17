
import { jstDateOffset } from '@/lib/jst-datetime'
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
    { key: 'addUrl', title: '友だち追加 URL', detail: addUrlState === 'passed' && basicId ? `https://line.me/R/ti/p/@${basicId.replace(/^@/, '')}` : '3 が通ると確かめます', state: addUrlState, message: null },
  ]
}

/**
 * ④の行に出す説明。止まった行は「なぜ止まったか」を1つだけ出す（同じことを2回書かない）。
 * Webhook は内訳から作った説明（オフ・登録先違い）がそのまま理由なので、段の文を重ねない。
 * 内訳が無いときだけ段の文を括弧で足す。チャネル・プロバイダーは「認証済み」の説明を出さず理由を出す。
 */
export function checkRowText(row: V8CheckRow): string {
  if (row.state !== 'failed' || !row.message) return row.detail
  if (row.key === 'webhook') return row.detail === '受け口へ届きませんでした' ? `${row.detail}（${row.message}）` : row.detail
  return row.message
}

export function allV8RowsPassed(rows: V8CheckRow[]): boolean {
  return rows.every((row) => row.state === 'passed')
}

/** 友だち数の統計は前日分。日本時間の昨日を yyyyMMdd で返す。 */
export function insightDateJst(now: Date = new Date()): string {
  return jstDateOffset(-1, now).replaceAll('-', '')
}

export const DRAFT_KEY = 'musubo-register-draft-v8'
export type StepNumber = 1 | 2 | 3 | 4 | 5
export interface DraftState {
  step: StepNumber
  /** v06：②③の中の小さな段（1始まり）。段の無い画面では1。 */
  sub: number
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
    const total = subTotal(parsed.step)
    const sub = typeof parsed.sub === 'number' && Number.isInteger(parsed.sub) && parsed.sub >= 1 && parsed.sub <= Math.max(1, total) ? parsed.sub : 1
    const draft: DraftState = {
      step: parsed.step, sub, accountMethod: parsed.accountMethod === 'new' ? 'new' : 'existing',
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
  return { ...messagingApiErrors(form), ...loginChannelErrors(form) }
}

/* ===== ここから v06（LINE新規追加_v06.pen・2026-10-15承認）の小さな計算 ===== */

/** ②の Step1 で入れる Messaging API の2項目だけを調べる。 */
export function messagingApiErrors(form: Pick<ChannelFields, 'channelId' | 'channelSecret'>): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!form.channelId.trim()) errors.channelId = 'チャネルIDを入力してください。'
  else if (!/^\d+$/.test(form.channelId.trim())) errors.channelId = 'チャネルIDは半角数字で入力してください。'
  if (!form.channelSecret) errors.channelSecret = 'チャネルシークレットを入力してください。'
  return errors
}

/** ②の Step3 で入れる LINEログインの2項目だけを調べる。 */
export function loginChannelErrors(form: Pick<ChannelFields, 'loginChannelId' | 'loginChannelSecret'>): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!form.loginChannelId.trim()) errors.loginChannelId = 'LoginチャネルIDを入力してください。'
  else if (!/^\d+$/.test(form.loginChannelId.trim())) errors.loginChannelId = 'LoginチャネルIDは半角数字で入力してください。'
  if (!form.loginChannelSecret) errors.loginChannelSecret = 'Loginチャネルシークレットを入力してください。'
  return errors
}

/** ②は3つ、③は2つの小さな段に分かれる。ほかの画面に小さな段は無い。 */
export function subTotal(stage: StepNumber): number {
  return stage === 2 ? 3 : stage === 3 ? 2 : 0
}

/** 小さな段の見出しの字。「Step 2 / 3」。状態の札ではない。段の無い画面では空。 */
export function stepLabel(stage: StepNumber, sub: number): string {
  const total = subTotal(stage)
  return total === 0 ? '' : `Step ${Math.min(Math.max(sub, 1), total)} / ${total}`
}

/**
 * ②Step2・Step3で利用者に確かめてもらう印。
 * LINE には「Webhook の利用／再送／エラーの統計情報」「友だち追加オプションのリンク」
 * 「公開済み化」を書き換える API が無いので、musubo からは設定できない。手で入れてもらう。
 */
export interface AckItem { key: string; label: string; note: string }
export const WEBHOOK_ACKS: ReadonlyArray<AckItem> = [
  { key: 'webhookUse', label: 'Webhookの利用をONにした', note: 'OFFのままだと、お客さまのメッセージが musubo に届きません。' },
  { key: 'webhookRedelivery', label: 'Webhookの再送をONにした', note: '通信が一時的に失敗したとき、LINEが送り直してくれます。' },
  { key: 'webhookErrorStats', label: 'エラーの統計情報をONにした', note: '届かなかったときの原因が分かるようになります。' },
]
export const LOGIN_ACKS: ReadonlyArray<AckItem> = [
  { key: 'addFriendLink', label: '友だち追加オプションで、この公式アカウントをリンクした', note: 'ここをつないでおくと、musubo が作る友だち追加の窓口が正しく動きます。' },
  { key: 'published', label: 'チャネルを「開発中」から「公開済み」にした', note: '開発中のままだと、お客さま側でログインの画面が開きません。' },
]

/** 印がすべて入っているか。1つでも残っていれば次の段へ進めない。 */
export function allAcked(acks: ReadonlyArray<{ key: string }>, checked: Record<string, boolean>): boolean {
  return acks.every((ack) => checked[ack.key] === true)
}

/** LINE Developers のチャネル画面。配下の画面名は未確認なのでチャネルの入口まで。 */
export function developerChannelUrl(channelId: string): string {
  const id = channelId.trim()
  return id ? `https://developers.line.biz/console/channel/${encodeURIComponent(id)}` : 'https://developers.line.biz/console/'
}

export type CheckRowPhase = 'waiting' | 'checking' | 'ok' | 'error'
export interface V06CheckRow { key: V8CheckRow['key']; title: string; detail: string; phase: CheckRowPhase }

type RowKey = V8CheckRow['key']

/** ③Step1の5行の見出し。承認済みの Lwxyh／EKLKb の文のまま。 */
const V06_ROW_TITLES: Record<RowKey, string> = {
  channel: 'LINEとつながるかの確認',
  provider: '同じプロバイダーかの確認',
  webhook: 'Webhook URL の登録',
  lineId: 'アカウント名・@ID・アイコンの取り込み',
  addUrl: '友だち追加の窓口（LIFF）の用意',
}

/** 押す前（EKLKb）の説明文。 */
const V06_ROW_IDLE: Record<RowKey, string> = {
  channel: 'いただいた4項目で、2つのチャネルに接続できるか試します。',
  provider: '別のプロバイダーに作られていると、ここで分かります。',
  webhook: 'musubo のURLを自動で登録して、テスト送信まで行います。',
  lineId: 'LINEから読み取って自動で表示します。入力はいりません。',
  addUrl: '友だち追加のURLとQRコードを自動で作ります。',
}

/** 通ったとき（V9Jbn）の説明文。 */
const V06_ROW_OK: Record<RowKey, string> = {
  channel: '2つのチャネルに接続できました。',
  provider: '同じプロバイダーの中にありました。',
  webhook: 'Webhook URL を登録しました。',
  lineId: 'アカウント名・@ID・アイコンを取り込みました。',
  addUrl: '友だち追加の窓口（LIFF）を作りました。',
}

/** 止まったとき（eqJbD／Tn6tJ）の説明文。 */
const V06_ROW_ERROR: Record<RowKey, string> = {
  channel: '2つのチャネルに接続できませんでした。チャネルIDとチャネルシークレットを確認してください。',
  provider: 'LINEログインのチャネルが、Messaging API と別のプロバイダーにありました。',
  webhook: 'URLは登録できましたが、「Webhookの利用」がOFFのままです。上の案内のとおりONにしてください。',
  lineId: 'アカウント名・@ID・アイコンを取り込めませんでした。',
  addUrl: '友だち追加の窓口（LIFF）を作れませんでした。',
}

/** Webhook が止まったときだけ、後ろの2行は Webhook 待ちの言い方になる（eqJbD）。 */
const V06_ROW_AFTER_WEBHOOK: Partial<Record<RowKey, string>> = {
  lineId: 'Webhookの確認が終わってから取り込みます。',
  addUrl: 'Webhookの確認が終わってから作ります。',
}

const V06_CHECKING = 'いま確認しています。そのままお待ちください。'
const V06_PENDING = '前の確認が終わってから行います。'

/**
 * ③Step1の5行。合否は connectCheck の1回の返事がすべて持っている。
 * 上から順に出すのは画面側の見せ方で、カーソルより手前は実際の合否、カーソルの行は「確認中」、
 * 後ろは「待機中」。返事が来る前はカーソル0の行だけが「確認中」になる。
 * 説明文は承認済みの Lwxyh の5状態（押す前・確認中・すべてOK・WebhookがOFF・プロバイダーが別）から選ぶ。
 */
export function toV06CheckRows(connection: LineAccountConnectData | null, view: { running: boolean; cursor: number }): V06CheckRow[] {
  const base = toV8CheckRows(connection)
  const phases = base.map((row, i): CheckRowPhase => {
    const settled: CheckRowPhase = row.state === 'passed' ? 'ok' : row.state === 'failed' ? 'error' : 'waiting'
    if (!view.running) return settled
    if (i < view.cursor) return settled
    return i === view.cursor ? 'checking' : 'waiting'
  })
  const webhookStopped = phases[2] === 'error'
  return base.map((row, i) => {
    const phase = phases[i]
    const detail = phase === 'checking' ? V06_CHECKING
      : phase === 'ok' ? V06_ROW_OK[row.key]
      : phase === 'error' ? V06_ROW_ERROR[row.key]
      : webhookStopped && V06_ROW_AFTER_WEBHOOK[row.key] ? (V06_ROW_AFTER_WEBHOOK[row.key] as string)
      : i === 0 || phases.slice(0, i).every((p) => p === 'waiting') ? V06_ROW_IDLE[row.key]
      : V06_PENDING
    return { key: row.key, title: V06_ROW_TITLES[row.key], detail, phase }
  })
}

/** 次に出す行。今の行が通っていれば1つ進める。止まった行で演出を終える。 */
export function nextCursor(rows: V06CheckRow[], cursor: number): number | null {
  if (cursor >= rows.length) return null
  return rows[cursor].phase === 'error' ? null : cursor + 1
}

export function allV06RowsOk(rows: V06CheckRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.phase === 'ok')
}

/** ③Step1のボタンの文。押せるかどうかは画面側で決める。 */
export function checkActionLabel(view: { running: boolean; attempted: boolean; allOk: boolean }): string {
  if (view.running) return '確認しています…'
  if (view.allOk) return '確認が終わりました'
  return view.attempted ? 'もう一度確かめる' : '接続を確かめる'
}

export type CheckStage = 'idle' | 'running' | 'webhookOff' | 'error' | 'done'

/** ③Step1の今の様子。赤い枠に出す文を選ぶために使う。 */
export function checkStage(connection: LineAccountConnectData | null, running: boolean): CheckStage {
  if (running) return 'running'
  if (!connection) return 'idle'
  if (allV8RowsPassed(toV8CheckRows(connection))) return 'done'
  return connection.verification?.webhook?.active === false ? 'webhookOff' : 'error'
}

export interface CheckNotice { tone: 'info' | 'danger'; title: string; body: string }

/**
 * 5行の上に出す案内箱。承認済みの Lwxyh では
 * WebhookがOFF（eqJbD）は青い箱、プロバイダーが別（Tn6tJ）は赤い箱。
 */
export function checkErrorText(stage: CheckStage, rows: V06CheckRow[]): CheckNotice | null {
  if (stage !== 'error' && stage !== 'webhookOff') return null
  if (stage === 'webhookOff') {
    return {
      tone: 'info',
      title: '「Webhookの利用」をONにしてください',
      body: 'LINE Developers ＞ Messaging API 設定 ＞ Webhook設定 で「Webhookの利用」をONにし、この画面に戻って「もう一度確かめる」を押してください。URLの入力は不要です（musubo が登録済みです）。',
    }
  }
  const stopped = rows.find((row) => row.phase === 'error')
  if (stopped?.key === 'provider') {
    return {
      tone: 'danger',
      title: 'LINEログインのチャネルを同じプロバイダーに作り直してください',
      body: 'いま入れていただいたLINEログインのチャネルは、Messaging API とは別のプロバイダーにありました。同じプロバイダーの中にLINEログインのチャネルを作り、そのチャネルIDとチャネルシークレットを入れ直してください。入力済みの内容はそのまま残っています。',
    }
  }
  return {
    tone: 'danger',
    title: stopped ? `${stopped.title}で止まりました` : '接続を確かめられませんでした',
    body: stopped
      ? `${stopped.detail} LINE Developers の設定を見直してから、もう一度確かめてください。入力済みの内容はそのまま残っています。`
      : 'LINE Developers の設定を見直してから、もう一度確かめてください。入力済みの内容はそのまま残っています。',
  }
}

export interface TemplateOption { key: string; node: string; label: string; note: string; enabled: boolean }

/**
 * ④の業種ひな型。初回のローンチは飲食店だけ選べる（利用者の指定）。
 * ほかは「順次公開」の札を出して押せないままにする。公開するときは enabled を true にする。
 */
export function templateOptions(): TemplateOption[] {
  return [
    { key: 'restaurant', node: 'MELvy', label: '飲食店向け', note: '今日の来店（時刻・席・人数）を先頭に出します。席の予約が始めから使えます', enabled: true },
    { key: 'salon', node: 'J1tGCr', label: 'サロン', note: '担当者ごとの今日の予約を先頭に出します。担当者を選ぶ予約が始めから使えます', enabled: false },
    { key: 'meeting', node: 'U74H4', label: '面談・相談', note: '今日の面談を先頭に出します。オンラインは［面談を開く］、対面は場所が出ます', enabled: false },
    { key: 'ec', node: 'Y0ldyt', label: 'ECサイト', note: '未発送の注文を先頭に出します。注文と発送の連絡が始めから使えます', enabled: false },
    { key: 'lesson', node: 'd0vdd', label: '教室・レッスン', note: '今日のクラスと残り枠を先頭に出します。教室とオンラインの枠は別々に数えます', enabled: false },
    { key: 'standard', node: 'H2d2y', label: '標準', note: '今のダッシュボードのままです。カードは、あとから自分で足し引きできます', enabled: false },
  ]
}

/** 「3分20秒」のような日本語の長さ。0以下・数でないものは空。 */
export function formatJaDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return ''
  const whole = Math.round(seconds)
  const hour = Math.floor(whole / 3600)
  const minute = Math.floor((whole % 3600) / 60)
  const second = whole % 60
  if (hour > 0) return minute > 0 ? `${hour}時間${minute}分` : `${hour}時間`
  if (minute > 0) return second > 0 ? `${minute}分${second}秒` : `${minute}分`
  return `${second}秒`
}

export interface HandoverProgress { imported: number; total: number | null; rate: number; perMinute: number | null; remainingSeconds: number | null; done: boolean }

/** 引き継ぎ中（S16DJ）の進み具合。総人数が分からないうちは割合を出さない。 */
export function handoverProgress(input: { imported: number; total: number | null; elapsedSeconds: number; running: boolean }): HandoverProgress {
  const imported = Math.max(0, Math.round(input.imported))
  const total = input.total !== null && input.total > 0 ? Math.round(input.total) : null
  const rate = total ? Math.min(100, Math.round((imported / total) * 100)) : (input.running ? 0 : 100)
  const perMinute = input.elapsedSeconds > 0 && imported > 0 ? Math.max(1, Math.round(imported / (input.elapsedSeconds / 60))) : null
  const left = total ? Math.max(0, total - imported) : null
  const remainingSeconds = perMinute && left !== null ? Math.round((left / perMinute) * 60) : null
  return { imported, total, rate, perMinute, remainingSeconds, done: !input.running }
}

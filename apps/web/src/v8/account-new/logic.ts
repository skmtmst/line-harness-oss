
import { jstDateOffset } from '@/lib/jst-datetime'
/*
 * ★V8 LINEアカウントを登録の、画面に依らない小さな計算。
 * src/v8 からは @/app を読めないので、今の登録（app/accounts/connection-check-view.ts・
 * app/accounts/new/account-recovery.ts・app/accounts/new/register-v8.tsx）から写した。
 * 中身・判定は同じ。片方を直したらもう片方も同じに直す。
 */
// 下の readDraft で使う。下の `export * from './precheck'` は出し直しだけで、ここでは使えない。
import { readPrecheckAnswers, readPrecheckAt, type PrecheckAnswers, type PrecheckAt } from './precheck'

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

/** 友だち数の統計は前日分。日本時間の昨日を yyyyMMdd で返す。 */
export function insightDateJst(now: Date = new Date()): string {
  return jstDateOffset(-1, now).replaceAll('-', '')
}


export const DRAFT_KEY = 'musubo-register-draft-v8'
export type StepNumber = 1 | 2 | 3 | 4 | 5
export interface DraftState {
  step: StepNumber
  /** v07：②③の中の小さな段（1始まり）。段の無い画面では1。 */
  sub: number
  accountMethod: 'existing' | 'new'
  /** ①事前確認の答えと、今出している面。古い下書きには無いので既定へ寄せる。 */
  precheck: PrecheckAnswers
  precheckAt: PrecheckAt
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
    const precheck = readPrecheckAnswers(parsed.precheck)
    const draft: DraftState = {
      step: parsed.step, sub, accountMethod: parsed.accountMethod === 'new' ? 'new' : 'existing',
      precheck, precheckAt: readPrecheckAt(parsed.precheckAt, precheck),
      name: text(parsed.name), channelId: text(parsed.channelId), loginChannelId: text(parsed.loginChannelId), lineId: text(parsed.lineId),
      tagIds: ids(parsed.tagIds), parentId: text(parsed.parentId), staffIds: ids(parsed.staffIds), liffId: text(parsed.liffId),
      importFriends: parsed.importFriends !== false,
    }
    // 手順1のまま何も入れていない下書きは戻さない（画面を開き直しただけで「下書きから続けます」を出さない）。
    const empty = draft.step === 1 && draft.precheckAt === 'q1' && Object.keys(draft.precheck).length === 0
      && !draft.name && !draft.channelId && !draft.loginChannelId
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

/* ===== ここから v07（LINE新規追加_v07.pen・2026-10-18承認）の小さな計算 ===== */

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
  /* 承認済み v07（LINE新規追加_v07.pen・2026-10-18承認）で足した印（dqe2M）。
     URLを貼って「更新」を押すまで、LINE側に下の3つのスイッチが出てこない。 */
  { key: 'webhookUrlPasted', label: 'Webhook URL を貼り付けて「更新」を押した', note: '貼り付けて更新しないと、下の3つのスイッチが表示されません。' },
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

/**
 * 承認済み v07 ②Step2 の「musubo の Webhook URL」（Ds3E2 の vnh17）に出す字。
 * 受け取り口は apps/worker の expectedWebhookUrl と同じ `<APIの元>/webhook`。
 * 元が未設定のときは字を作らない（画面側で「不明」を出す）。
 */
export function musuboWebhookUrl(): string {
  const base = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '')
  return base ? `${base}/webhook` : ''
}

/** LINE Developers のチャネル画面。配下の画面名は未確認なのでチャネルの入口まで。 */
export function developerChannelUrl(channelId: string): string {
  const id = channelId.trim()
  return id ? `https://developers.line.biz/console/channel/${encodeURIComponent(id)}` : 'https://developers.line.biz/console/'
}


/* 切り出した先。読む側の import を変えないよう、ここからそのまま出し直す。 */
export * from './precheck'
export * from './connection-check'
export * from './check-rows'

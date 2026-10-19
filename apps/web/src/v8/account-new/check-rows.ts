import type { AccountStyle } from '@line-crm/shared'
import { styleTerm } from '@/lib/terms'
import type { LineAccountConnectData } from '@/lib/api'
import { allV8RowsPassed, toV8CheckRows, type V8CheckRow } from './connection-check'

/*
 * ★LINE新規追加_v07.pen（2026-10-18承認）③接続確認 Lwxyh・④使い方 X0pGdw・⑤完了 Plmq1 の、
 * 画面に依らない小さな計算。logic.ts が行数の関所（1ファイル400行）を越えたため切り出した。
 * 中身・判定は変えていない。
 */

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

export interface TemplateOption { key: AccountStyle; node: string; label: string; note: string; enabled: boolean }

/**
 * ④の業種ひな型。登録する6業種は共通の正式キーで保存する。
 * 表示名は共通の辞書と合わせる。
 */
export function templateOptions(): TemplateOption[] {
  return [
    { key: 'restaurant', node: 'MELvy', label: styleTerm('restaurant', 'V01'), note: '今日の来店（時刻・席・人数）を先頭に出します。席の予約が始めから使えます', enabled: true },
    { key: 'salon', node: 'J1tGCr', label: styleTerm('salon', 'V01'), note: '担当者ごとの今日の予約を先頭に出します。担当者を選ぶ予約が始めから使えます', enabled: true },
    { key: 'consult', node: 'U74H4', label: styleTerm('consult', 'V01'), note: '今日の面談を先頭に出します。オンラインは［面談を開く］、対面は場所が出ます', enabled: true },
    { key: 'ec', node: 'Y0ldyt', label: styleTerm('ec', 'V01'), note: '未発送の注文を先頭に出します。注文と発送の連絡が始めから使えます', enabled: true },
    { key: 'lesson', node: 'd0vdd', label: styleTerm('lesson', 'V01'), note: '今日のクラスと残り枠を先頭に出します。教室とオンラインの枠は別々に数えます', enabled: true },
    { key: 'standard', node: 'H2d2y', label: styleTerm('standard', 'V01'), note: '今のダッシュボードのままです。カードは、あとから自分で足し引きできます', enabled: true },
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

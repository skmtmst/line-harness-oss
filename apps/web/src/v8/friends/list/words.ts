/*
 * ★V8 友だち一覧の言葉と日付の書き方（x6QsVz）。
 * 状態の名前は受信箱・詳細と同じ（v7 の friend-list-row と同じ4つ）。
 */
import type { FriendListItem } from '@/lib/api'

export type StatusTone = 'danger' | 'warn' | 'info' | 'ok'

export function statusOf(status: FriendListItem['chatStatus']): { label: string; tone: StatusTone } {
  if (status === 'unread') return { label: '未対応', tone: 'danger' }
  if (status === 'in_progress') return { label: '対応中', tone: 'warn' }
  if (status === 'on_hold') return { label: '保留', tone: 'info' }
  return { label: '対応済み', tone: 'ok' }
}

/** 最終接触は受信・送信の新しい方（R112・v7 と同じ式）。 */
export function lastContactOf(friend: FriendListItem): string {
  const incomingAt = friend.latestIncomingMessage?.createdAt
  const outgoingAt = friend.latestOutgoingAt
  if (incomingAt && outgoingAt) {
    return new Date(incomingAt).getTime() >= new Date(outgoingAt).getTime() ? incomingAt : outgoingAt
  }
  return incomingAt ?? outgoingAt ?? friend.createdAt
}

const TYPE_WORDS: Record<string, string> = {
  sticker: 'スタンプ',
  image: '画像',
  video: '動画',
  audio: '音声',
  file: 'ファイル',
  location: '位置情報',
}

export function messageWord(message: { content: string; messageType: string }): string {
  return message.messageType === 'text' ? message.content : TYPE_WORDS[message.messageType] ?? 'メッセージ'
}

function jstParts(iso: string): { y: number; m: number; d: number; hh: number; mm: number } | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? NaN)
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') }
}

function thisYear(): number {
  return jstParts(new Date().toISOString())?.y ?? new Date().getFullYear()
}

/** 8月14日（年が違うときは 2025年8月14日）。 */
export function monthDay(iso: string): string {
  const p = jstParts(iso)
  if (!p) return '—'
  return `${p.y !== thisYear() ? `${p.y}年` : ''}${p.m}月${p.d}日`
}

/**
 * 8月14日 7:58。受信の時刻は記録の文字のまま読む（v7 の一覧と同じ：時差の換算をしない）。
 */
export function monthDayTime(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso)
  if (!match) return '—'
  const [, y, m, d, hh, mm] = match
  return `${Number(y) !== thisYear() ? `${y}年` : ''}${Number(m)}月${Number(d)}日 ${Number(hh)}:${mm}`
}

/**
 * タグの列は幅 160。短いタグなら2つ、長いタグは1つだけ札にして残りを「+N」。
 * 全部の名前は列の title で読める。
 */
export function splitTags<T extends { name: string }>(tags: T[]): { shown: T[]; rest: number } {
  if (tags.length === 0) return { shown: [], rest: 0 }
  const [first, second] = tags
  const fitsTwo = second !== undefined && [...first.name].length + [...second.name].length <= 7
  const shown = fitsTwo ? [first, second] : [first]
  return { shown, rest: tags.length - shown.length }
}

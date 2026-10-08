/*
 * 本文の差し込み（{{name}} など）を、本文の欄で「札」として見せるための読み取り。
 * 保存する値は今までどおりの文字（{{name}} など）。ここは見せ方だけを決める。
 *
 * 札にするのは、送るときに本当に置き換わる形だけ（名前・配信日・友だち情報・
 * 共通情報・LIFF ID・目標日までの日数）。分からない {{…}} は文字のまま残す
 * （札にすると「置き換わる」と誤解させるため）。
 * 画面ごとに意味が違う差し込み（リマインダの {{date}}＝予約日時、統括の {店名} など）は
 * 画面から `extra` で渡す。`extra` が先に勝つ。
 */

export type InsertTokenIcon = 'user' | 'calendar' | 'idcard' | 'braces' | 'phone' | 'clock' | 'video' | 'store' | 'link'

export interface InsertTokenSpec {
  /** 本文に入る文字（保存する値）。 */
  token: string
  /** 札の文字。 */
  label: string
  /** 札に乗せたときの説明（何に置き換わるか）。 */
  hint: string
  icon: InsertTokenIcon
}

/** 友だち情報・共通情報の名前（キー → 画面の名前）。分からなければキーのまま見せる。 */
export interface InsertTokenNames {
  fields?: ReadonlyMap<string, string> | Record<string, string>
  vars?: ReadonlyMap<string, string> | Record<string, string>
}

const DATE_HINTS: Record<string, string> = {
  '': '8月20日(水)',
  ymd_w: '2026年8月20日(水)',
  md: '8月20日',
  ymd: '2026年8月20日',
  slash_md_w: '8/20(水)',
  slash_ymd_w: '2026/8/20(水)',
  slash_md: '8/20',
  slash_ymd: '2026/8/20',
}

function lookup(names: InsertTokenNames['fields'], key: string): string | undefined {
  if (!names) return undefined
  if (names instanceof Map) return names.get(key)
  return (names as Record<string, string>)[key]
}

/** {{…}} の中身から札を決める。札にしないものは null。 */
export function resolveDefaultToken(token: string, names: InsertTokenNames = {}): InsertTokenSpec | null {
  const inner = /^\{\{\s*([^{}\n]+?)\s*\}\}$/.exec(token)?.[1]
  if (!inner) return null
  if (inner === 'name') return { token, label: '名前', hint: '受け取る人の名前に置き換わります', icon: 'user' }
  if (inner === 'liff_id') return { token, label: 'LIFF ID', hint: 'LIFF ID に置き換わります', icon: 'phone' }
  const date = /^date(?::([a-z_]+))?$/.exec(inner)
  if (date) {
    const example = DATE_HINTS[date[1] ?? '']
    if (example === undefined) return null
    return { token, label: '配信日', hint: `配信日（例：${example}）に置き換わります`, icon: 'calendar' }
  }
  const after = /^date\+(\d{1,3})$/.exec(inner)
  if (after) return { token, label: `配信日の${after[1]}日後`, hint: `配信日の${after[1]}日後の日付に置き換わります`, icon: 'calendar' }
  const until = /^days_until:(\d{4})-(\d{2})-(\d{2})$/.exec(inner)
  if (until) {
    const day = `${Number(until[1])}/${Number(until[2])}/${Number(until[3])}`
    return { token, label: `${day}まで`, hint: `${day}までの日数に置き換わります（過ぎた日は0）`, icon: 'clock' }
  }
  const field = /^field\.([a-z][a-z0-9_]*)$/.exec(inner)
  if (field) {
    const name = lookup(names.fields, field[1])
    return { token, label: name ?? field[1], hint: `友だち情報「${name ?? field[1]}」の値に置き換わります`, icon: 'idcard' }
  }
  const commonVar = /^var\.([a-z][a-z0-9_]*)$/.exec(inner)
  if (commonVar) {
    const name = lookup(names.vars, commonVar[1])
    return { token, label: name ?? commonVar[1], hint: `共通情報「${name ?? commonVar[1]}」の値に置き換わります`, icon: 'braces' }
  }
  return null
}

export type InsertPiece = { kind: 'text'; text: string } | { kind: 'chip'; spec: InsertTokenSpec }

/**
 * 本文を「文字」と「札」の並びに分ける。並びをつなぐと元の本文に戻る
 * （文字は1文字も足さない・引かない）。
 */
export function splitInsertTokens(value: string, extra: readonly InsertTokenSpec[] = [], names: InsertTokenNames = {}): InsertPiece[] {
  const pieces: InsertPiece[] = []
  const exact = [...extra].sort((a, b) => b.token.length - a.token.length)
  let text = ''
  let index = 0
  const flush = () => {
    if (text) pieces.push({ kind: 'text', text })
    text = ''
  }
  while (index < value.length) {
    const rest = value.slice(index)
    const own = exact.find((spec) => rest.startsWith(spec.token))
    if (own) {
      flush()
      pieces.push({ kind: 'chip', spec: own })
      index += own.token.length
      continue
    }
    if (rest.startsWith('{{')) {
      const candidate = /^\{\{[^{}\n]*\}\}/.exec(rest)?.[0]
      const spec = candidate ? resolveDefaultToken(candidate, names) : null
      if (candidate && spec) {
        flush()
        pieces.push({ kind: 'chip', spec })
        index += candidate.length
        continue
      }
    }
    text += value[index]
    index += 1
  }
  flush()
  return pieces
}

/** 友だち情報・共通情報の一覧から、札の名前の表を作る。 */
export function referenceTokenNames(references: {
  friendFields: ReadonlyArray<{ fieldKey: string; name: string }>
  commonVars: ReadonlyArray<{ varKey: string; name: string }>
}): InsertTokenNames {
  return {
    fields: Object.fromEntries(references.friendFields.map((field) => [field.fieldKey, field.name])),
    vars: Object.fromEntries(references.commonVars.map((item) => [item.varKey, item.name])),
  }
}

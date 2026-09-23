/**
 * 共通情報の画面で共通に使う言い換え。
 *
 * 一覧・登録・編集の3画面で同じ呼び名を出す必要がある。page.tsx から
 * 名前付きで持ち出すと、画面ファイルが他の画面の部品置き場になるので、
 * ここに置く。
 */

/**
 * 種別の呼び名。
 *
 * 保存できる種別は text / url / image / number / long_text / date / datetime / boolean（common_vars の
 * CHECK 制約）。Lステップの「標準・数値・長文・年月日」とは中身が違うので、
 * 「標準」だけ名前を合わせ、残りは実際に保存できるものの名前を出す。
 */
export const VAR_TYPE_LABELS: Record<string, string> = {
  text: '標準',
  url: 'URL',
  image: '画像',
  number: '数値',
  long_text: '長文',
  date: '年月日',
  datetime: '日時',
  boolean: '真偽',
}

/**
 * 空欄を許さない種別（VAR-06）。
 *
 * 真偽・年月日・日時は、空文字がサーバの型検査（normalizeCommonVarValue）
 * で弾かれる。値欄に必須の印を付け、送信前に画面で止める。
 */
export const COMMON_VAR_VALUE_REQUIRED: ReadonlySet<string> = new Set([
  'boolean',
  'date',
  'datetime',
])

/** 年月日・日時の実在検査。worker の normalizeCommonVarValue と同じ判定。 */
function isRealCalendarValue(type: 'date' | 'datetime', value: string): boolean {
  const match = type === 'date'
    ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    : /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day, hour = '00', minute = '00'] = match.slice(1)
  const at = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)))
  return at.getUTCFullYear() === Number(year) && at.getUTCMonth() === Number(month) - 1
    && at.getUTCDate() === Number(day) && at.getUTCHours() === Number(hour)
    && at.getUTCMinutes() === Number(minute)
}

/**
 * 種別ごとの値検査（VAR-06）。新規・編集・代替値・更新予約で同じ判定を使う。
 *
 * サーバの normalizeCommonVarValue（packages/db/src/common-vars.ts）と
 * 同じ条件を送信前に画面で検査し、通らないときは理由の文を返す。
 * 通るときは null。label は「代替値」「更新後の値」のように呼び名を
 * 変えるためのもの。
 */
export function commonVarValueError(type: string, value: string, label = '値'): string | null {
  if (type === 'boolean') {
    if (value === '') return `${label}を選んでください`
    return value === 'true' || value === 'false'
      ? null
      : `${label}は種別に合う値を入力してください`
  }
  if (type === 'date') {
    if (value === '') return `${label}の日付を入力してください`
    return isRealCalendarValue('date', value)
      ? null
      : `${label}は 2026-09-16 のような実在する日付で入力してください`
  }
  if (type === 'datetime') {
    if (value === '') return `${label}の日時を入力してください`
    return isRealCalendarValue('datetime', value)
      ? null
      : `${label}は 2026-09-16T10:00 のような実在する日時で入力してください`
  }
  if (type === 'long_text') {
    return value.length <= 10_000 ? null : `${label}は10,000文字までで入力してください`
  }
  // 画像はLINEへ画像URLとして差し込まれる。URLでない文字列は送信時に
  // 壊れるため https URL だけを受ける（VAR-03。サーバも同じ判定）。
  if (type === 'image') {
    if (value === '') return null
    return value.length <= 200 && /^https:\/\/\S+$/.test(value)
      ? null
      : `${label}は https:// からはじまるURLで入力してください`
  }
  return value.length <= 200 ? null : `${label}は200文字までで入力してください`
}

/** 「2026-08-26T10:00」→「2026/08/26(水) 10:00」。列に収まる長さにする。 */
export function formatStamp(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value)
  if (!match) return value
  const [, y, m, d, hh, mm] = match
  const week = ['日', '月', '火', '水', '木', '金', '土'][
    new Date(Number(y), Number(m) - 1, Number(d)).getDay()
  ]
  return `${y}/${m}/${d}(${week})${hh ? ` ${hh}:${mm}` : ''}`
}

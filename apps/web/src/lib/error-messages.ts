import { api, ApiError } from './api'

/**
 * 失敗の文面を対応表から引く。設計 ★V6 34（要件 v6-34 §9）。
 *
 * **route の error 原文（英語・内部語・SQL）をそのまま出さない。**
 * 画面はコードで表を引き、表に無いものは汎用文面と追跡番号に落とす。
 *
 * 表は起動時に一度取って版ごとキャッシュする（§12）。取れなければ
 * 汎用文面だけで進める——対応表が読めないことを理由に画面を止めない。
 */

export interface ErrorMessageEntry {
  code: string
  message: string
  nextAction: { kind: 'navigate' | 'retry' | 'contact_admin' | 'none'; target: string | null }
  version: number
}

export interface FailureCopy {
  /** 運用者向け文面。差し込み（{incidentId} など）は埋め済み。 */
  message: string
  /** 次の行動。押せるものだけ。 */
  action: {
    kind: 'navigate' | 'retry' | 'contact_admin' | 'none'
    href: string | null
    label: string | null
  }
  /** 追跡番号。あれば画面は「（追跡番号 …）」を添える。 */
  trackingId: string | null
}

const ACTION_LABEL: Record<FailureCopy['action']['kind'], string | null> = {
  navigate: null, // 行き先ごとに画面が文を決める
  retry: 'もう一度試す',
  contact_admin: '管理者へ連絡',
  none: null,
}

let tableCache: Map<string, ErrorMessageEntry> | null = null
let tablePromise: Promise<Map<string, ErrorMessageEntry>> | null = null

/**
 * 対応表を一度だけ取る。**取れなくても画面を止めない。**
 * 失敗したら空の表を返し、呼び出し側は汎用文面で進める。
 */
export function loadErrorMessageTable(): Promise<Map<string, ErrorMessageEntry>> {
  if (tableCache) return Promise.resolve(tableCache)
  if (tablePromise) return tablePromise
  tablePromise = api.errorMessages
    .list()
    .then((res) => {
      const map = new Map<string, ErrorMessageEntry>()
      if (!res.success) return map
      for (const row of res.data ?? []) {
        map.set(row.code, {
          code: row.code,
          message: row.message,
          nextAction: row.nextAction,
          version: row.version,
        })
      }
      tableCache = map
      return map
    })
    .catch(() => {
      // 表が読めないことを理由に画面を止めない。空表 = 全部汎用文面。
      tablePromise = null
      return new Map<string, ErrorMessageEntry>()
    })
  return tablePromise
}

/** 試験と再ログイン用にキャッシュを捨てる。 */
export function resetErrorMessageTable(): void {
  tableCache = null
  tablePromise = null
}

/** `{incidentId}` `{requestId}` `{n}` `{max}` などの差し込みを埋める。 */
function fill(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = vars[key]
    return value == null ? whole : String(value)
  })
}

/** 追跡番号が無いとき、追跡番号を含む言い回しを崩さないように削る。 */
function dropMissingTrackingId(message: string, trackingId: string | null): string {
  if (trackingId) return message
  return message
    .replace(/（追跡番号 \{[^}]+\}）/g, '')
    .replace(/\(追跡番号 \{[^}]+\}\)/g, '')
    .trim()
}

/**
 * 失敗を運用者の言葉にする。
 *
 * 引き順:
 *   1. `err.code` の完全一致
 *   2. `err.message` の完全一致（code を持たない現行 route）
 *   3. `LINE API error: NNN` のような前方一致（コード化されていないので）
 *   4. 対応表に無い → 汎用文面＋追跡番号。**原文は出さない。**
 */
export function resolveFailureCopy(
  err: unknown,
  table: Map<string, ErrorMessageEntry>,
): FailureCopy {
  const apiErr = err instanceof ApiError ? err : null
  const trackingId = apiErr?.trackingId ?? null

  const candidates: string[] = []
  if (apiErr?.code) candidates.push(apiErr.code)
  if (apiErr?.message && !/^API error: /.test(apiErr.message)) candidates.push(apiErr.message)
  // ステータスだけ分かる応答の転ばぬ先（表が原文鍵を持っている）。
  if (apiErr?.status === 429) candidates.push('rate_limit')
  if (apiErr && apiErr.status >= 500) candidates.push('Internal Server Error')

  let entry: ErrorMessageEntry | undefined
  for (const key of candidates) {
    entry = table.get(key)
    if (entry) break
  }
  if (!entry) {
    // 「LINE API error: 403」のような前方一致。表の鍵が先頭に付く応答を拾う。
    for (const key of candidates) {
      for (const [code, row] of table) {
        if (key.startsWith(`${code}:`) || key.startsWith(`${code} `)) {
          entry = row
          break
        }
      }
      if (entry) break
    }
  }

  if (!entry) {
    return {
      message: trackingId
        ? `処理できませんでした（追跡番号 ${trackingId}）`
        : '処理できませんでした',
      action: { kind: 'contact_admin', href: null, label: ACTION_LABEL.contact_admin },
      trackingId,
    }
  }

  const message = dropMissingTrackingId(
    fill(entry.message, {
      incidentId: trackingId,
      requestId: trackingId,
    }),
    trackingId,
  )
  return {
    message,
    action: {
      kind: entry.nextAction.kind,
      href: entry.nextAction.kind === 'navigate' ? entry.nextAction.target : null,
      label: ACTION_LABEL[entry.nextAction.kind],
    },
    trackingId,
  }
}

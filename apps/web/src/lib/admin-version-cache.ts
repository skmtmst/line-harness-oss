/*
 * 画面を移るたびに取り直していた共通のものを、タブ内で使い回す。
 *
 * 対象: /admin/version（動いている版の番号）。共通メニューのいちばん上
 * （SidebarIdentity）と更新案内の帯（UpdateBanner 経由の update-client）が、
 * 同じ版番号を別々に取りに行っていた。版番号はしばらく変わらないので、
 * 短いあいだ共有する。
 *
 * 約束:
 * - 同時の要求は1本に相乗りさせる（取得中の Promise を共有する）
 * - 取れた答えは SHARE_MS のあいだ使い回す。失敗は覚えない（次は取り直す）
 * - 版の表示と更新の判断材料にだけ使う
 */

const SHARE_MS = 5 * 60_000

export interface AdminVersion {
  version: string
}

export interface AdminVersionDetail {
  version: string
  worker_hash: string
  admin_hash: string
  liff_hash: string
}

let entry: { at: number; promise: Promise<AdminVersionDetail> } | null = null

function fetchVersion(apiUrl: string): Promise<AdminVersionDetail> {
  return fetch(`${apiUrl}/admin/version`).then(async (res) => {
    if (!res.ok) throw new Error(`version fetch failed ${res.status}`)
    const body = (await res.json()) as {
      version?: string
      worker_hash?: string
      admin_hash?: string
      liff_hash?: string
    }
    return {
      version: body?.version ?? '',
      worker_hash: body?.worker_hash ?? '',
      admin_hash: body?.admin_hash ?? '',
      liff_hash: body?.liff_hash ?? '',
    }
  })
}

function load(): Promise<AdminVersionDetail> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL
  if (!apiUrl) return Promise.resolve({ version: '', worker_hash: '', admin_hash: '', liff_hash: '' })
  const now = Date.now()
  if (entry && now - entry.at < SHARE_MS) return entry.promise
  const promise = fetchVersion(apiUrl)
  entry = { at: now, promise }
  // 失敗は覚えない。取れなかった版を使い回すと、復旧後も版が出ないまま残る。
  const forget = () => {
    if (entry?.promise === promise) entry = null
  }
  promise.then(
    (res) => {
      if (!res.version) forget()
    },
    forget,
  )
  return promise
}

/** 版番号だけ要る側（共通メニューのいちばん上）。 */
export function loadAdminVersion(): Promise<AdminVersion> {
  return load().then((detail) => ({ version: detail.version }))
}

/** 版の照合まで要る側（更新案内の帯）。 */
export function loadAdminVersionDetail(): Promise<AdminVersionDetail> {
  return load()
}

/** 試験でやり直すときに捨てる。 */
export function clearAdminVersionCache(): void {
  entry = null
}

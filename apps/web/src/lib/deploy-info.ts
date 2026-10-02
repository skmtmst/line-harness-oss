import type { AdminVersionDetail } from './admin-version-cache'
import { formatDateTime } from '@/lib/format'

/**
 * メニューの下に出す版の表示（★V7 監査の直し E）の組み立て。
 *
 * - 1行目: `Ver. 2.7.0（a1b2c3d）`
 * - 2行目: `9/27 13:05 配備・検証環境`
 * - 取れない・仮の値のときは null（画面は「版の情報なし」と出す。仮値は出さない）
 */

/** 組み立てを通さないビルドに入る仮の版。画面に出さない。 */
const PLACEHOLDER_VERSIONS = new Set(['0.0.0-dev', '0.0.0', 'local'])

export function isRealVersion(version: string | null | undefined): boolean {
  const v = (version ?? '').trim()
  return v !== '' && !PLACEHOLDER_VERSIONS.has(v)
}

/** commit の頭7文字。仮・不明・形が違うものは null。 */
export function shortCommit(commit: string | null | undefined): string | null {
  const c = (commit ?? '').trim().toLowerCase()
  if (!/^[0-9a-f]{7,}$/.test(c)) return null
  if (/^0+$/.test(c)) return null
  return c.slice(0, 7)
}

/** 配備の日時は `M/D HH:MM`（日本時間）。変な値は null。 */
export function formatDeployedAt(iso: string | null | undefined): string | null {
  const raw = (iso ?? '').trim()
  if (!raw) return null
  const time = Date.parse(raw)
  if (!Number.isFinite(time)) return null
  const at = new Date(time)
  if (at.getUTCFullYear() < 2024) return null
  return formatDateTime(at)
}

/** 環境の呼び名。知らない値はそのまま出す（勝手に日本語を作らない）。 */
export function deployEnvLabel(env: string | null | undefined): string | null {
  const e = (env ?? '').trim()
  if (!e) return null
  if (e === 'staging') return '検証環境'
  if (e === 'production') return '本番環境'
  return e
}

export interface DeployInfoLines {
  line1: string
  /** 日時も環境も取れないときは空。 */
  line2: string
}

/**
 * 版の2行。版そのものが取れない・仮のときは null。
 * commit が無い版だけでは「どのコードか」が分からないので、日時・環境と
 * 同じく欠けた1行としては出さず、版の行だけ出す。
 */
export function formatDeployInfo(detail: AdminVersionDetail | null | undefined): DeployInfoLines | null {
  if (!detail || !isRealVersion(detail.version)) return null
  const version = detail.version.trim()
  const commit = shortCommit(detail.git_commit)
  const line1 = commit ? `Ver. ${version}（${commit}）` : `Ver. ${version}`
  const second: string[] = []
  const at = formatDeployedAt(detail.released_at)
  if (at) second.push(`${at} 配備`)
  const env = deployEnvLabel(detail.deploy_env)
  if (env) second.push(env)
  return { line1, line2: second.join('・') }
}

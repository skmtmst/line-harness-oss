'use client'

import { ShieldCheck } from 'lucide-react'

/**
 * 環境帯（★V6 37 共通 `OGkIw`）。本番は墨色（ink）、検証は橙（status-warn-deep）。
 * 統括・店舗の画面と一目で見分けるためのもの。判定は API の URL で行う。
 */
export function opsEnvironmentLabel(apiUrl: string | undefined): 'production' | 'staging' {
  const url = (apiUrl ?? '').toLowerCase()
  if (!url) return 'staging'
  if (/stg|staging|localhost|127\.0\.0\.1|-dev|\.dev\b/.test(url)) return 'staging'
  return 'production'
}

export default function OpsEnvBar() {
  const env = opsEnvironmentLabel(process.env.NEXT_PUBLIC_API_URL)
  const production = env === 'production'
  return (
    <div
      data-design-node="OGkIw"
      className={production
        ? 'flex h-8 items-center justify-between bg-ink px-5 text-caption font-bold text-on-accent'
        : 'flex h-8 items-center justify-between bg-status-warn-deep px-5 text-caption font-bold text-on-accent'}
    >
      <span className="flex items-center gap-2">
        <ShieldCheck aria-hidden="true" className="h-4 w-4" />
        musubo 運営コンソール ／ {production ? '本番' : '検証環境'}
      </span>
      <span className="text-nano font-normal text-on-accent opacity-80">契約先のデータを扱います。操作はすべて記録されます</span>
    </div>
  )
}

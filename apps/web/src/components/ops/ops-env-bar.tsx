'use client'

import { ShieldCheck } from 'lucide-react'
import Notice from '@/components/shared/notice'

/**
 * 環境帯（★管理画面 37 共通 `OGkIw`）。本番は墨色（ink）、検証は橙（status-warn-deep）。
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
    <Notice data-design-node="OGkIw" tone={production ? 'info' : 'warn'}
      icon={<ShieldCheck aria-hidden="true" />}
      heading={<>musubo 運営コンソール ／ {production ? '本番' : '検証環境'}</>}
    >契約先のデータを扱います。操作はすべて記録されます</Notice>
  )
}

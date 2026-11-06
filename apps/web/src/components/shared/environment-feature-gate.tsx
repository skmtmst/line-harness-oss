'use client'

import { usePathname, useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { environmentFeatureUiEnabled } from '@/lib/environment-features'
import PreparingDialog from './preparing-dialog'

/** 直接 URL を開いたときも未公開の画面や API を読み込まず、共通の窓を出す。 */
export default function EnvironmentFeatureGate({ children, feature }: { children: ReactNode; feature: string }) {
  const pathname = usePathname()
  const router = useRouter()
  if (environmentFeatureUiEnabled(pathname ?? '')) return children
  return <PreparingDialog open feature={feature} onClose={() => router.replace('/hq')} />
}

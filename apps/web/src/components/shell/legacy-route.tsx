'use client'

import { Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useListNavigationRouter } from '@/components/shared/list-navigation'
import PagePending from '@/components/templates/page-pending'
import { legacyRouteDestination, type LegacyRoutePath } from '@/lib/canonical-route'
import { defaultTitleForPath, documentTitleForPath } from '@/lib/page-title'
import { usePageTitle } from './page-chrome'

/** 古い入口を直接開いたときも、移動先の題と共通の待機表示を使う。 */
export default function LegacyRoute({ from }: { from: LegacyRoutePath }) {
  const path = legacyRouteDestination(from).split('?')[0]
  usePageTitle(documentTitleForPath(path, defaultTitleForPath(path)))
  return <Suspense fallback={<PagePending stage="route" />}><Redirect from={from} /></Suspense>
}

function Redirect({ from }: { from: LegacyRoutePath }) {
  const params = useSearchParams()
  const router = useListNavigationRouter()
  const destination = legacyRouteDestination(from, params?.toString())
  useEffect(() => { router.replace(destination + window.location.hash) }, [destination, router])
  return <PagePending stage="route" />
}

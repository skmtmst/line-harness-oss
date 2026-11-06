'use client'
import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import InflowListV8 from '@/v8/inflow-links/list'
function Edit() { return <InflowListV8 editId={useSearchParams().get('id') ?? ''} /> }
export default function Page() { return <Suspense fallback={<PagePending stage="route" {...routePendingForPath("/inflow-links/edit")} />}><Edit /></Suspense> }

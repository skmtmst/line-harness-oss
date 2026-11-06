'use client'
import PagePending from '@/components/templates/page-pending'
import { routePendingForPath } from '@/lib/route-pending'
import { Suspense } from 'react'
import { StaffEditV8 } from '@/v8/settings/staff/staff'
export default function Page() { return <Suspense fallback={<PagePending stage="route" {...routePendingForPath("/staff/edit")} />}><StaffEditV8 /></Suspense> }

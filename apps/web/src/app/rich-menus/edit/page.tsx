'use client'

import dynamic from 'next/dynamic'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import ListState from '@/components/shared/list-state'
const RichMenuCreateV8 = dynamic(() => import('../new/create-v8'), { ssr: false })
const RichMenuDetailV8 = dynamic(() => import('@/v8/rich-menu-edit/detail'), { ssr: false })

function Entry() {
  const params = useSearchParams()
  const groupId = params.get('id') ?? ''
  return params.get('step') ? <RichMenuCreateV8 editGroupId={groupId} /> : <RichMenuDetailV8 groupId={groupId} />
}
function Page() { return <Suspense fallback={<ListState kind="loading" />}><Entry /></Suspense> }

export default Page

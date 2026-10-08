'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import ListState from '@/components/shared/list-state'
import FriendAddListV8 from '@/v8/friend-add/list'
import FriendAddEditorV8 from '@/v8/friend-add/editor'

function FriendAddSettingsInner() {
  const params = useSearchParams()
  const view = params.get('view')
  if (view === 'new') return <FriendAddEditorV8 />
  if (view === 'edit') return <FriendAddEditorV8 ruleId={params.get('id') ?? undefined} />
  return <FriendAddListV8 />
}

export default function FriendAddSettingsPage() {
  return <Suspense fallback={<ListState kind="loading" />}><FriendAddSettingsInner /></Suspense>
}

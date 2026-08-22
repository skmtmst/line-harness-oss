'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import FriendAttributesV4States, { type FriendAttributesV4State } from '@/components/friend-attributes-v4/friend-attributes-v4-states'

const allowed = new Set<FriendAttributesV4State>(['fields', 'marks', 'searches', 'csv'])

function PageInner() {
  const requested = useSearchParams().get('state') as FriendAttributesV4State | null
  return <FriendAttributesV4States state={requested && allowed.has(requested) ? requested : 'fields'} />
}

export default function FriendAttributesV4StatesPage() {
  return <Suspense fallback={null}><PageInner /></Suspense>
}

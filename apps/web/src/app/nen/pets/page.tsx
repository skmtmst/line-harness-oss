'use client'

import { jstDate } from '@/lib/jst-datetime'


import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import PetsPageV8 from '@/v8/nen-pets/pets'

export type PetTab = 'pets' | 'feeding'

export default function NenPetsPage() {
  return <Suspense fallback={null}><PetsInner /></Suspense>
}

function PetsInner() {
  usePageTitle('マイペット')
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId } = useAccount()
  const tab: PetTab = params.get('tab') === 'feeding' ? 'feeding' : 'pets'
  const changeTab = (next: PetTab) => router.replace(next === 'pets' ? '/nen/pets' : `/nen/pets?tab=${next}`)
  return <PetsPageV8 accountId={selectedAccountId} tab={tab} onChangeTab={changeTab} />
}

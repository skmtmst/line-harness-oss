'use client'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import ConversionListV8 from '@/v8/conversions/list'
function Edit() { const { selectedAccountId } = useAccount(); return <ConversionListV8 accountId={selectedAccountId} editId={useSearchParams().get('id') ?? ''} /> }
export default function Page() { return <Suspense><Edit /></Suspense> }

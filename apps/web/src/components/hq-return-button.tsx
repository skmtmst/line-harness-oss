'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'

export default function HqReturnButton() {
  const pathname = usePathname()
  const router = useRouter()
  const { clearSelectedAccountId } = useAccount()

  if (pathname.startsWith('/hq')) return null

  return (
    <div className="mb-4 flex justify-end">
      <Button
        type="button"
        onClick={() => {
          clearSelectedAccountId()
          router.push('/hq')
        }}
        variant="secondary"
      >
        統括
      </Button>
    </div>
  )
}

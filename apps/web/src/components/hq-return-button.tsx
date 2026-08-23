'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'

export default function HqReturnButton() {
  const pathname = usePathname()
  const router = useRouter()
  const { clearSelectedAccountId } = useAccount()

  if (pathname.startsWith('/hq')) return null

  return (
    <div className="mb-4 flex justify-end">
      <button
        type="button"
        onClick={() => {
          clearSelectedAccountId()
          router.push('/hq')
        }}
        className="rounded-control border border-hairline bg-canvas px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors hover:border-accent hover:text-accent"
      >
        統括
      </button>
    </div>
  )
}

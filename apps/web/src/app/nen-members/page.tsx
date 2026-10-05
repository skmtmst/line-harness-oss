'use client'

import { useAccount } from '@/contexts/account-context'
import PhotoReviewV8 from './photo-review-v8'

export default function PhotoReviewsPage() {
  const { selectedAccountId } = useAccount()
  return <PhotoReviewV8 key={selectedAccountId ?? 'no-account'} accountId={selectedAccountId} />
}

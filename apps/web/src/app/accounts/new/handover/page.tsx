'use client'

import { Suspense } from 'react'
import ResumeFollowerHandover from '@/v8/account-new/resume-handover'

export default function HandoverPage() {
  return <Suspense fallback={null}><ResumeFollowerHandover /></Suspense>
}

'use client'

import { Suspense } from 'react'
import TemplateDetailV8 from '@/v8/template-detail/detail'

export default function TemplateDetailPage() {
  return <Suspense fallback={null}><TemplateDetailV8 /></Suspense>
}

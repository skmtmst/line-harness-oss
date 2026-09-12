'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { TEMPLATE_TYPES, type TemplateType } from '@/lib/hq-templates-api'
import TemplateConsole from './template-console'

function Content() {
  const params = useSearchParams()
  const requested = params.get('type') ?? 'tag'
  const type = TEMPLATE_TYPES.includes(requested as TemplateType) ? requested as TemplateType : null
  return type ? <TemplateConsole key={type} type={type} /> : <p role="alert">ひな形の種類を確認してください。</p>
}
export default function HqTemplatesPage() {
  return <Suspense fallback={<p role="status">ひな形を読み込み中…</p>}><Content /></Suspense>
}

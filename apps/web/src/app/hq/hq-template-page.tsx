'use client'

import { Suspense } from 'react'
import type { HqOpenTargetKey } from '@/lib/hq-navigation'
import type { TemplateType } from '@/lib/hq-templates-api'
import TemplateConsole from './templates/template-console'

/** 既存の呼び出し口を保ち、V8の作成・配布へつなぐ。 */
export default function HqTemplatePage({ type, label }: { type: TemplateType; label: string; target: HqOpenTargetKey }) {
  return <Suspense fallback={<p role="status">{label}を読み込み中…</p>}><TemplateConsole type={type} /></Suspense>
}

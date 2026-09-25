'use client'

import { Suspense } from 'react'
import { usePageTitle } from '@/components/shell/page-chrome'
import TargetMissing from '@/components/shared/target-missing'
import { HQ_TEMPLATE_DISTRIBUTION_ENABLED } from '@/lib/hq-template-availability'
import { hqOpenHref, type HqOpenTargetKey } from '@/lib/hq-navigation'
import type { TemplateType } from '@/lib/hq-templates-api'
import TemplateConsole from './templates/template-console'

function Unavailable({ label, target }: { label: string; target: HqOpenTargetKey }) {
  usePageTitle(label)
  return (
    <section aria-label={`統括の${label}`}>
      <TargetMissing
        kind="unspecified"
        title={`統括からの${label}の作成・配布はまだ使えません`}
        description={`アカウントごとの${label}は、アカウントを選んで開いてください。`}
        backHref={hqOpenHref(target)}
        backLabel="アカウントを選ぶ"
      />
    </section>
  )
}

export default function HqTemplatePage({ type, label, target }: { type: TemplateType; label: string; target: HqOpenTargetKey }) {
  return <Suspense fallback={<p role="status">{label}を読み込み中…</p>}>
    {HQ_TEMPLATE_DISTRIBUTION_ENABLED ? <TemplateConsole type={type} /> : <Unavailable label={label} target={target} />}
  </Suspense>
}

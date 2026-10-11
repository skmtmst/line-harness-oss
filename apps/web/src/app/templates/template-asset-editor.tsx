'use client'
import TemplateRichV8 from '@/v8/template-edit/rich'
import TemplateAssetV8 from '@/v8/template-edit/asset'
type AssetKind = 'rich_message' | 'coupon' | 'research'

export default function TemplateAssetEditor({ kind, visual = false }: { kind: AssetKind; visual?: boolean }) {
  return kind === 'rich_message' ? <TemplateRichV8 visual={visual} /> : <TemplateAssetV8 kind={kind} visual={visual} />
}

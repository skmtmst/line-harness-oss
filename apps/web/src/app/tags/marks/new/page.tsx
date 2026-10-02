'use client'

import SupportMarkEditor from '@/components/friend-fields/support-mark-editor'
import MarkEditorV8 from '@/app/tags/mark-editor-v8'
import FeatureGate from '@/components/feature-gate'
import { useAdminTheme } from '@/lib/use-admin-theme'

export default function NewSupportMarkPage() {
  const theme = useAdminTheme()
  return <FeatureGate feature="support_marks">{theme === 'v8' ? <MarkEditorV8 /> : <SupportMarkEditor />}</FeatureGate>
}

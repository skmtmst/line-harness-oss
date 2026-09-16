import SupportMarkEditor from '@/components/friend-fields/support-mark-editor'
import FeatureGate from '@/components/feature-gate'

export default function NewSupportMarkPage() {
  return <FeatureGate feature="support_marks"><SupportMarkEditor /></FeatureGate>
}

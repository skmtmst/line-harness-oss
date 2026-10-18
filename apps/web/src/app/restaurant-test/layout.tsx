import EnvironmentFeatureGate from '@/components/shared/environment-feature-gate'

export default function RestaurantTestLayout({ children }: { children: React.ReactNode }) {
  return <EnvironmentFeatureGate feature="飲食店向けの機能">{children}</EnvironmentFeatureGate>
}

'use client'

import { usePageTitle } from '@/components/shell/page-chrome'
import FeatureSettingsScreen from '@/v8/settings/features/screen'

export default function SettingsPage() {
  usePageTitle('機能設定')
  return <FeatureSettingsScreen />
}

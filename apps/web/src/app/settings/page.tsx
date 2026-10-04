'use client'

import { usePageTitle } from '@/components/shell/page-chrome'
import { FeatureSettingsV8 } from './feature-settings-v8'

export default function SettingsPage() {
  usePageTitle('機能設定')
  return <FeatureSettingsV8 />
}

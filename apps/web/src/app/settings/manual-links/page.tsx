'use client'

import { usePageTitle } from '@/components/shell/page-chrome'
import ManualLinksScreen from '@/v8/settings/manual-links/screen'

export default function SettingsPage() {
  usePageTitle('マニュアルの対応表')
  return <ManualLinksScreen />
}

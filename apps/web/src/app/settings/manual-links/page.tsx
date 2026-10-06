'use client'

import { usePageTitle } from '@/components/shell/page-chrome'
import { ManualLinksV8 } from './manual-links-v8'

export default function SettingsPage() {
  usePageTitle('マニュアルの正本表')
  return <ManualLinksV8 />
}

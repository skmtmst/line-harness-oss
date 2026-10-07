'use client'

import { usePageTitle } from '@/components/shell/page-chrome'
import FileScanScreen from '@/v8/settings/file-scan/screen'

export default function SettingsPage() {
  usePageTitle('ファイルの検査')
  return <FileScanScreen />
}

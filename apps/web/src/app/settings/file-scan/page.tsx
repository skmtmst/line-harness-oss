'use client'

import { usePageTitle } from '@/components/shell/page-chrome'
import { FileScanV8 } from './file-scan-v8'

export default function SettingsPage() {
  usePageTitle('ファイルの検査')
  return <FileScanV8 />
}

'use client'

import { useAdminTheme } from '@/lib/use-admin-theme'
import GoogleBusinessPage from './google-business'
import GoogleV8 from '../v8/google'

/* ★V8 切替（板 `j0Wcg`）。v7 の見た目は data-theme="v8" が付くまで変えない。 */
export default function Page() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <GoogleV8 /> : <GoogleBusinessPage />
}

'use client'

import { useAdminTheme } from '@/lib/use-admin-theme'
import WebinarListV8 from '@/v8/webinars/list'
import WebinarListCurrent from './list-v8'

/* V8 のときだけ新しい一覧（src/v8/webinars）。それ以外は今の一覧のまま。 */
export default function WebinarsPage() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <WebinarListV8 /> : <WebinarListCurrent />
}

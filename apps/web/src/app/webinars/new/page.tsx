'use client'

import { useAdminTheme } from '@/lib/use-admin-theme'
import WebinarNewV8 from '@/v8/webinar-edit/new'
import WebinarNewCurrent from './new-v8'

/* V8 のときだけ新しい作る画面（src/v8/webinar-edit/new）。それ以外は今の作る画面のまま。 */
export default function WebinarNewPage() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <WebinarNewV8 /> : <WebinarNewCurrent />
}

'use client'

import { useAdminTheme } from '@/lib/use-admin-theme'
import OrganizationV8 from '@/v8/restaurant/organization/organization'
import RestaurantConsole from '../restaurant-console'

/* ★V8 切替（板 `bSp4h`）。画面は src/v8/restaurant/organization。v7 の見た目は data-theme="v8" が付くまで変えない。 */
export default function Page() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <OrganizationV8 /> : <RestaurantConsole view="organization" />
}

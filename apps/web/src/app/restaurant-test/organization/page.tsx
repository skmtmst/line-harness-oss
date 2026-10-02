'use client'

import { useAdminTheme } from '@/lib/use-admin-theme'
import RestaurantConsole from '../restaurant-console'
import OrganizationV8 from '../v8/organization'

/* ★V8 切替（板 `bSp4h`）。v7 の見た目は data-theme="v8" が付くまで変えない。 */
export default function Page() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <OrganizationV8 /> : <RestaurantConsole view="organization" />
}

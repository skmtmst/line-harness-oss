'use client'

import { useAdminTheme } from '@/lib/use-admin-theme'
import RestaurantConsole from '../restaurant-console'
import DashboardV8 from '../v8/dashboard'

/* ★V8 切替（板 `CHz31`）。v7 の見た目は data-theme="v8" が付くまで変えない。 */
export default function Page() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <DashboardV8 /> : <RestaurantConsole view="dashboard" />
}

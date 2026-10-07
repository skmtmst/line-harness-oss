'use client'

import { useAdminTheme } from '@/lib/use-admin-theme'
import RestaurantConsole from '../restaurant-console'
import TablesPage from '@/v8/restaurant/tables/tables'

/* ★V8 切替（板 `BERxg`）。v7 の見た目は data-theme="v8" が付くまで変えない。画面は src/v8/restaurant/tables。 */
export default function Page() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <TablesPage /> : <RestaurantConsole view="tables" />
}

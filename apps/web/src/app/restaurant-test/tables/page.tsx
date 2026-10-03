'use client'

import { useAdminTheme } from '@/lib/use-admin-theme'
import RestaurantConsole from '../restaurant-console'
import TablesV8 from '../v8/tables'

/* ★V8 切替（板 `BERxg`）。v7 の見た目は data-theme="v8" が付くまで変えない。 */
export default function Page() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <TablesV8 /> : <RestaurantConsole view="tables" />
}

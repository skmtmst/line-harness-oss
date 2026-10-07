'use client'

import { useAdminTheme } from '@/lib/use-admin-theme'
import RestaurantConsole from '../restaurant-console'
import InventoryPage from '@/v8/restaurant/inventory/inventory'

/* ★V8 切替（板 `Y8SjT2`・`Yyw6i`・`hQQlt`・競合 `qf3ky`）。v7 の見た目は data-theme="v8" が付くまで変えない。画面は src/v8/restaurant/inventory。 */
export default function Page() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <InventoryPage /> : <RestaurantConsole view="inventory" />
}

'use client'

import { useAdminTheme } from '@/lib/use-admin-theme'
import RestaurantConsole from '../restaurant-console'
import InventoryV8 from '../v8/inventory'

/* ★V8 切替（板 `Y8SjT2`・競合 `qf3ky`）。v7 の見た目は data-theme="v8" が付くまで変えない。 */
export default function Page() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <InventoryV8 /> : <RestaurantConsole view="inventory" />
}

'use client'

import { useAdminTheme } from '@/lib/use-admin-theme'
import RestaurantConsole from '../restaurant-console'
import MenuV8 from '../v8/menu'

/* ★V8 切替（板 `MJoJR`）。v7 の見た目は data-theme="v8" が付くまで変えない。 */
export default function Page() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <MenuV8 /> : <RestaurantConsole view="menu" />
}

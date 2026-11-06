import type { BookingMenu } from '@/lib/api'
import type { LoadStatus } from './shared'

export type MenusTabProps = {
  accountId: string
  menus: BookingMenu[]
  status: LoadStatus
  error: string | null
  menuCount: number | undefined
  canEdit: boolean
  onReload: () => void
  /** 担当スタッフのタブを開く（担当がいないメニューの札から）。 */
  onOpenStaff: () => void
}

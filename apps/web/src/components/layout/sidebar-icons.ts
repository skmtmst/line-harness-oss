import {
  Bell, CalendarCheck, CalendarCog, Clipboard, ClipboardList, Clock, FileText, Folder, House, Inbox,
  LayoutGrid, MessageCircleMore, Send, Tag, Ticket, Trophy, Type, UserPlus, Users, Video, type LucideIcon,
} from 'lucide-react'
/*
 * ★V8 の左メニューの印（絵 d8X09・ の「項目 〇〇 / 印」は lucide）。
 * V8 のときだけ使い、互換経路は MENU_SECTIONS の線画のまま。載っていない項目も 管理画面 の線画。鍵は MENU_SECTIONS の id。
 */
export const V8_NAV_ICONS: Record<string, LucideIcon> = {
  dashboard: House,
  inbox: Inbox,
  friends: Users,
  'friend-attributes': Tag,
  scenarios: ClipboardList,
  broadcasts: Send,
  reminders: Bell,
  'auto-replies': MessageCircleMore,
  'friend-add-settings': UserPlus,
  webinars: Video,
  templates: FileText,
  'rich-menus': LayoutGrid,
  forms: Clipboard,
  'common-vars': Type,
  contents: Folder,
  'booking-bookings': CalendarCheck,
  'booking-menus': CalendarCog,
  events: Ticket,
  'booking-own-shifts': Clock,
  affiliates: Trophy,
}

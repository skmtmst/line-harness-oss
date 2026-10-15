import { createElement } from 'react'
import {
  Armchair, Ban, Bell, BellOff, BookOpen, Building2, CalendarCheck, CalendarDays, CalendarX, CircleCheck, Clock, CreditCard, Download,
  FileText, FolderOpen, GraduationCap, Hourglass, Image as ImageIcon, LayoutGrid, Lightbulb, List, MessageCircle, MessagesSquare, Repeat,
  Scissors, Settings, ShoppingBag, SlidersHorizontal, Sparkles, Split, Stamp, Store, Ticket, User, UserCheck, Users, Utensils, type LucideIcon,
} from 'lucide-react'

/* はじめの質問・見本のリッチメニューで使う印（名前 → lucide）。 */
const ICONS: Record<string, LucideIcon> = {
  utensils: Utensils, scissors: Scissors, messages: MessagesSquare, graduation: GraduationCap, bag: ShoppingBag, grid: LayoutGrid,
  sparkles: Sparkles, image: ImageIcon, folder: FolderOpen, download: Download, hourglass: Hourglass, settings: Settings,
  circleCheck: CircleCheck, userCheck: UserCheck, store: Store, card: CreditCard, split: Split, calendarX: CalendarX, clock: Clock,
  bell: Bell, bellOff: BellOff, stamp: Stamp, ticket: Ticket, ban: Ban, armchair: Armchair, users: Users, user: User,
  calendarCheck: CalendarCheck, list: List, book: BookOpen, message: MessageCircle, file: FileText, bulb: Lightbulb,
  building: Building2, repeat: Repeat, calendarDays: CalendarDays, sliders: SlidersHorizontal,
}

/** 印の大きさ・色は呼ぶ側の class で決める（class は呼ぶ側の CSS Modules から渡す）。 */
export function SetupIcon({ name, className }: { name: string; className?: string }) {
  return createElement(ICONS[name] ?? LayoutGrid, { className, 'aria-hidden': true })
}

'use client'
import { type RichMenuAreaIntent } from '@line-crm/shared'
import {
CalendarCheck,CalendarClock,ClipboardList,Copy,
FileText,
History,
Link2,MessageCircle,MousePointerClick,Phone,Repeat,
Stamp,
Zap,
type LucideIcon,
} from 'lucide-react'
import styles from './canvas-v8.module.css'



/** 面の名前の上に置く印（動きの種類ごと）。動きが決まっていない面は「押す」の印。 */
export const INTENT_ICON: Record<RichMenuAreaIntent, LucideIcon> = {
  url: Link2, tel: Phone, text: MessageCircle, template: FileText, form: ClipboardList,
  switch: Repeat, postback: Zap, datetime: CalendarClock, clipboard: Copy,
  booking: CalendarCheck, booking_history: History, visit_stamp: Stamp,
}

export function AreaIcon({ intent, size = 20, presentation = 'canvas' }: { intent?: RichMenuAreaIntent | null; size?: number; presentation?: 'canvas' | 'preview' }) {
  const Icon = intent ? INTENT_ICON[intent] ?? MousePointerClick : MousePointerClick
  return <Icon size={size} aria-hidden="true" className={presentation === 'preview' ? styles.previewAreaIcon : styles.areaIcon} />
}

import { createPortal } from 'react-dom'
import styles from './tooltip-bubble.module.css'

/**
 * 共通の吹き出し（黒い地に白い文字）。省略した文字の全文と、アイコンだけのボタンの名前に使う。
 * 位置は呼び出し側が測って渡す。below が false なら指定した位置の上に出す。
 */
export default function TooltipBubble({ id, text, left, top, below, onMouseEnter, onMouseLeave }: {
  id: string
  text: string
  left: number
  top: number
  below: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}) {
  return createPortal(
    <span id={id} role="tooltip" className={styles.tooltip} data-below={below} data-interactive={onMouseEnter ? '' : undefined} style={{ left, top }} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>{text}</span>,
    document.body,
  )
}

import type { ButtonHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import Button from './button'
import styles from './sticky-bar.module.css'

/** 下の帯の左端。確認窓を開く副操作と、押せない場合の理由を同じ形で出す。 */
export default function StickyBarAction({ label, icon: Icon, disabledReason, disabled, destructive = false, ...props }: {
  label: string
  icon: LucideIcon
  disabledReason?: string | null
  /** 削除などの確認入口は白地の副ボタンに赤い文字と印を出す。 */
  destructive?: boolean
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'style'>) {
  return <div className={styles.leadAction}>
    <Button {...props} type="button" variant={destructive ? 'danger-outline' : 'secondary'} disabled={disabled || Boolean(disabledReason)} aria-description={disabledReason ?? undefined}>
      <Icon size={15} aria-hidden="true" />{label}
    </Button>
    {disabledReason ? <span className={styles.leadReason} role="note">{disabledReason}</span> : null}
  </div>
}

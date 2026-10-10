import type { HTMLAttributes, ReactNode } from 'react'
import { Eye } from 'lucide-react'
import styles from './read-only-notice.module.css'

export const READ_ONLY_MESSAGE = '閲覧のみで見ています。変える操作はオーナーか管理者に頼んでください。'

/** 閲覧権限の案内。形と印はここが持ち、権限の条件と置き場所は画面が持つ。 */
export default function ReadOnlyNotice({ children = READ_ONLY_MESSAGE, role = 'status', ...props }:
  Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'style' | 'children'> & { children?: ReactNode }) {
  return <div {...props} role={role} className={styles.band} data-read-only-notice>
    <Eye size={16} aria-hidden="true" />
    <span>{children}</span>
  </div>
}

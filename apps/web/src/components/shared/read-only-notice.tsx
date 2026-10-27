import type { HTMLAttributes, ReactNode } from 'react'
import Notice from './notice'

export const READ_ONLY_MESSAGE = '閲覧のみで見ています。変える操作はオーナーか管理者に頼んでください。'

/** 閲覧権限の案内。形と印はここが持ち、権限の条件と置き場所は画面が持つ。印は知らせの組の青い「i」（目の印は使わない）。 */
export default function ReadOnlyNotice({ children = READ_ONLY_MESSAGE, role = 'status', ...props }:
  Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'style' | 'children'> & { children?: ReactNode }) {
  return <Notice {...props} tone="info" role={role} data-read-only-notice>{children}</Notice>
}

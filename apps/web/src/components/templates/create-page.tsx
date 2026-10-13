import { AutoFormLeaveGuard, FormLeaveGuard } from '@/components/shared/form-leave-guard'
import type { ReactNode, HTMLAttributes, Ref } from 'react'
import StickyBar from '@/components/shared/sticky-bar'
import { PageFrame, PageHeading, type PageHeadingProps } from './page-frame'
import PreviewLauncher from './preview-launcher'
import styles from './page-templates.module.css'
import ReadOnlyNotice from '@/components/shared/read-only-notice'

export interface CreatePageProps extends PageHeadingProps {
  readOnly?: boolean
  /** 本文の入力をネイティブfieldsetでまとめて無効にする。 */
  contentDisabled?: boolean
  contentLabel?: string
  dirty?: boolean
  busy?: boolean
  boardId?: string
  elementRef?: Ref<HTMLDivElement>
  standalone?: boolean
  /** 短い入力は内容の高さ、長い入力は画面内に収めて本文だけを送る。 */
  heightMode?: 'viewport' | 'content'
  children: ReactNode

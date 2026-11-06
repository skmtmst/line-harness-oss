'use client'

import type { ReactNode } from 'react'
import AccountRequiredState from '@/components/shared/account-required-state'
import ListState from '@/components/shared/list-state'
import { MobileFrame, type MobileFrameBack } from '@/components/templates'
import { useDocumentTitle } from '@/components/shell/document-title'
import { useMobileShell } from './mobile-shell'

/*
 * 電話の画面 1 枚。外枠の共通の部分（帯・タブ・アカウント）は MobileShell から受け、
 * 題・戻る・返信欄だけを画面が渡す。
 * 権限の確認が済むまで・見る権限が無い・店を選んでいない時は、中身を出さずにその旨を出す。
 */
export default function MobileScreen({ title, back, permission, hideTabs, footer, children }: {
  title: string
  back?: MobileFrameBack | null
  /** PC の画面の権限の鍵。渡すと、見る権限の無い人には中身を出さない。 */
  permission?: string
  hideTabs?: boolean
  footer?: ReactNode
  children: ReactNode
}) {
  const shell = useMobileShell()
  useDocumentTitle(title)
  const allowed = shell.ready && (!permission || shell.canView(permission))
  const body = !shell.ready
    ? <ListState kind="loading" title="読み込んでいます" />
    : !allowed
      ? <ListState kind="forbidden" />
      : shell.needsAccount
        ? <AccountRequiredState hasAccounts={shell.hasAccounts} />
        : children
  return (
    <MobileFrame
      title={title}
      back={back}
      banner={shell.banner}
      band={shell.band}
      headerEnd={shell.headerEnd}
      tabs={shell.tabs}
      hideTabs={hideTabs}
      footer={allowed && !shell.needsAccount ? footer : undefined}
    >
      {body}
    </MobileFrame>
  )
}

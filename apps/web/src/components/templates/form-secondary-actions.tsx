'use client'

import type { ReactElement } from 'react'
import type { ButtonProps } from '@/components/shared/button'
import PageActionMenu from './page-action-menu'

export default function FormSecondaryActions({ buttons }: { buttons: ReactElement<ButtonProps>[] }) {
  return <PageActionMenu buttons={buttons} label="作成・編集のその他の操作" />
}

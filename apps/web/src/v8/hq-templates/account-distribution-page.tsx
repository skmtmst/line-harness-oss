'use client'

import type { ComponentProps } from 'react'
import { DistributionPage } from '@/components/templates/distribution-page'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import { ListPageBody } from '@/components/templates/list-page'
import { PageFooter } from '@/components/templates/page-footer'
import Notice from '@/components/shared/notice'
import { DistributionFolderPanel } from './distribution-accounts'

type Props = Pick<ComponentProps<typeof DistributionPage>, 'boardId' | 'stats' | 'toolbar' | 'notices' | 'actions' | 'overlays' | 'children' | 'title' | 'help'> & ComponentProps<typeof DistributionFolderPanel> & { selecting: boolean }

export default function AccountDistributionPage({ selecting, rows, activeId, onSelect, failed, ...page }: Props) {
  if (!selecting) return <DistributionPage {...page} />
  const { children, toolbar, notices, actions, overlays } = page
  return <PageFrame kind="distribution" layout="distribution" boardId="Ft2Ey">
    <PageHeading title={page.title} help={page.help} />
    <Notice tone="success" appearance="soft">配るアカウントを選んでください。</Notice>
    <ListPageBody contentInset folderInset
      folders={<DistributionFolderPanel rows={rows} activeId={activeId} onSelect={onSelect} failed={failed} />}
      folderNav={{ rows, activeId, onSelect, label: 'アカウントのフォルダ' }} toolbar={toolbar}>
      {notices}{children}
    </ListPageBody>
    <PageFooter actions={actions} presentation="distribution" />
    {overlays}
  </PageFrame>
}

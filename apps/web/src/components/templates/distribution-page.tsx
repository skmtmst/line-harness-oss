import type { ReactNode } from 'react'
import { PageFrame, PageHeading, type PageHeadingProps } from './page-frame'
import { PageFooter } from './page-footer'
import { ListPageBody } from './list-page'

/** 配布の板：題、数の帯、選ぶ道具、表、確認・実行の順。 */
export function DistributionPage({ boardId, stats, toolbar, folders, collapsedFolders, notices, actions, overlays, children, ...heading }: PageHeadingProps & {
  boardId: string; stats: ReactNode; toolbar: ReactNode; notices?: ReactNode;
  /** 左のフォルダの列。狭い板では collapsedFolders（選ぶ欄）に畳む。 */
  folders?: ReactNode; collapsedFolders?: ReactNode;
  actions: ReactNode; overlays?: ReactNode; children: ReactNode;
}) {
  return <PageFrame kind="distribution" layout="distribution" boardId={boardId}>
    <PageHeading {...heading} />
    <ListPageBody stats={stats} toolbar={toolbar} folders={folders} collapsedFolders={collapsedFolders} contentInset>
      {notices}{children}
    </ListPageBody>
    <PageFooter actions={actions} presentation="distribution" />
    {overlays}
  </PageFrame>
}

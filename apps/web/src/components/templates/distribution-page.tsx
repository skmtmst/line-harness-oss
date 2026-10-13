import type { ReactNode } from 'react'
import { PageFrame, PageHeading, PageFooter, type PageHeadingProps } from './page-frame'
import { ListPageBody } from './list-page'

/** 配布の板：題、数の帯、選ぶ道具、表、確認・実行の順。 */
export function DistributionPage({ boardId, stats, toolbar, notices, actions, overlays, children, ...heading }: PageHeadingProps & {
  boardId: string; stats: ReactNode; toolbar: ReactNode; notices?: ReactNode;
  actions: ReactNode; overlays?: ReactNode; children: ReactNode;
}) {
  return <PageFrame kind="distribution" layout="distribution" boardId={boardId}>
    <PageHeading {...heading} />
    <ListPageBody stats={stats} toolbar={toolbar} contentInset>
      {notices}{children}
    </ListPageBody>
    <PageFooter actions={actions} presentation="distribution" />
    {overlays}
  </PageFrame>
}

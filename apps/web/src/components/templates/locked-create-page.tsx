import type { ReactNode } from 'react'
import TargetMissing from '@/components/shared/target-missing'
import { PageFrame, PageHeading } from './page-frame'

/** 閲覧のみで作成・編集の入口を開いた時の共通の案内。子の読込や保存処理は持たない。 */
export function LockedCreatePage({ boardId, title, help, backHref, backLabel, mode = 'create', scope = 'store' }: {
  boardId?: string
  title: ReactNode
  help?: ReactNode
  backHref: string
  backLabel: string
  mode?: 'create' | 'edit'
  scope?: 'store' | 'hq'
}) {
  const words = mode === 'create' ? { cannot: '作れません', want: '作りたい' } : { cannot: '変えられません', want: '変えたい' }
  return <PageFrame kind="create" boardId={boardId}>
    <PageHeading title={title} help={help} />
    <TargetMissing kind="forbidden" title={`閲覧のみのため、ここでは${words.cannot}`}
      description={`${words.want}時は${scope === 'hq' ? '統括の管理者' : 'オーナーか管理者'}に頼んでください。`}
      backHref={backHref} backLabel={backLabel} />
  </PageFrame>
}

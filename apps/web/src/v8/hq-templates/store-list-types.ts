import type { ReactNode } from 'react'
import type { HqTemplateFolder, HqTemplateListStats, TemplateKind } from '@line-crm/shared'
import type { HqTemplate, TemplateType } from '@/lib/hq-templates-api'
export interface HqStoreListProps {
  type: TemplateType
  rows: HqTemplate[]
  ready: boolean
  busy: boolean
  canEdit: boolean
  /** 配る先になるアカウントの数（数の帯の「全 N アカウントのうち」）。 */
  accountTotal: number
  /** 一覧の集計（API-18：今月送った数・新しい版を未配布のひな形の数）。取れなければ null。 */
  stats?: HqTemplateListStats | null
  /** 6種類のタブ（テンプレートだけ）。 */
  kind?: TemplateKind
  kindCounts?: Partial<Record<TemplateKind, number>> | null
  onKindChange?: (kind: TemplateKind) => void
  folders: HqTemplateFolder[]
  folderLoadFailed: boolean
  folderFilter: string
  onFolderFilter: (id: string) => void
  onAddFolder: (name: string, color: string | null) => Promise<void>
  onRenameFolder: (folder: HqTemplateFolder, name: string, color: string | null) => Promise<void>
  onDeleteFolder: (folder: HqTemplateFolder) => Promise<void>
  /** ほかの人が先に直した・消した（409・404）ときにフォルダの一覧を読み直す。 */
  onReloadFolders?: () => Promise<void>
  onCreate: () => void
  onEdit: (row: HqTemplate) => void
  /** 名前を押したとき（詳細 ）。無ければ編集を開く。 */
  onOpen?: (row: HqTemplate) => void
  itemHref?: (row: HqTemplate) => string
  onDistributeFolder?: (id: string, name: string) => void
  /** 全種類を数える。種類タブや検索でフォルダの配布範囲を狭めない。 */
  folderContents?: HqTemplate[] | null
  onDistribute: (row: HqTemplate) => void
  onDuplicate: (row: HqTemplate) => void
  onRemove: (row: HqTemplate) => void
  notices?: ReactNode
  overlays?: ReactNode
}

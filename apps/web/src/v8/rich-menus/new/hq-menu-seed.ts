import type { HqRichMenuSeed } from '@/lib/hq-rich-menu-create'
import type { RichMenuCreateHost } from '@/lib/rich-menu-create-host'
import type { Group, Page } from './create-types'

export function makeHqMenuSeed({ host, name, chatBarText, folderId, size, group, audience, hqTagName, defaultOpen, targetingPriority, pages }: {
  host?: RichMenuCreateHost; name: string; chatBarText: string; folderId: string; size: 'large' | 'compact'; group: Group | null
  audience: 'all' | 'targeted' | 'none' | 'tag'; hqTagName: string; defaultOpen: boolean; targetingPriority: number; pages: Page[]
}): HqRichMenuSeed {
  return { id: host?.initial?.id, name: name.trim(), chatBarText: chatBarText.trim(), folderId: folderId || null,
    size: group?.size ?? size, displayAudience: audience === 'all' ? 'all' : audience === 'tag' ? 'tag' : 'store',
    displayTagName: audience === 'tag' ? hqTagName.trim() : '', defaultOpen, displayOrder: targetingPriority,
    defaultPageId: group?.defaultPageId ?? pages[0]?.id ?? '', pages: pages.map(page => ({ id:page.id, name:page.name, imageR2Key:page.imageR2Key, areas:page.areas })) }
}

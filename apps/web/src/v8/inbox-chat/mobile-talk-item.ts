import type { MobileTalkItem } from '@/components/templates'
import type { ChatListItem } from '@/lib/api'
import { formatListRecent, formatListRecentTitle } from '@/lib/format'
import { mobileTalkHref } from '@/lib/mobile-shell'
import { chatListPreview } from './list-preview'

/** 一覧の 1 件を電話の会話の一覧の形へ。 */
export function talkItem(chat: ChatListItem): MobileTalkItem {
  return {
    id: chat.id,
    name: chat.friendName,
    pictureUrl: chat.friendPictureUrl,
    preview: chatListPreview(chat),
    outgoing: chat.lastMessageDirection === 'outgoing',
    time: formatListRecent(chat.lastMessageAt),
    timeTitle: formatListRecentTitle(chat.lastMessageAt),
    unread: Boolean(chat.isUnread),
    href: mobileTalkHref(chat.friendId),
  }
}

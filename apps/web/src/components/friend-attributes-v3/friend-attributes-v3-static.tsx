import type { Tag, TagGroup } from '@line-crm/shared'
import FriendAttributesView, { type FriendAttributesFolderView, type FriendAttributesRowView } from '@/components/friend-attributes-v4/friend-attributes-view'

export const FRIEND_ATTRIBUTES_QA_GROUPS: TagGroup[] = [
  { id: 'qa-vip', name: 'VIP', sortOrder: 0, color: '#f29b22', createdAt: '', updatedAt: '' },
  { id: 'qa-pet', name: 'ペット', sortOrder: 1, color: '#e84d93', createdAt: '', updatedAt: '' },
  { id: 'qa-member', name: '会員', sortOrder: 2, color: '#18ae72', createdAt: '', updatedAt: '' },
  { id: 'qa-purchase', name: '購入', sortOrder: 3, color: '#4379ee', createdAt: '', updatedAt: '' },
]

export const FRIEND_ATTRIBUTES_QA_TAGS: Tag[] = [
  ['EC顧客連携済み', 'qa-purchase', 5, 10, 0, 12000],
  ['LINEログイン連携済み', 'qa-member', 5, 0, 0, null],
  ['NEN会員', 'qa-member', 5, 10, 5, 15000],
  ['商品到着確認対象', 'qa-purchase', 3, 3, 0, null],
  ['未契約', '', 3, 0, 0, null],
  ['誕生日クーポン対象', 'qa-vip', 0, 20, 0, null],
].map(([name, groupId, friendCount, mileageReward, referralMileageReward, mileageMultiplierBps], index) => ({
  id: `qa-${index}`,
  name: String(name),
  color: '#8b938d',
  groupId: String(groupId),
  friendCount: Number(friendCount),
  mileageReward: Number(mileageReward),
  referralMileageReward: Number(referralMileageReward),
  mileageMultiplierBps: mileageMultiplierBps == null ? null : Number(mileageMultiplierBps),
  mileageMultiplierPriority: 0,
  isStarred: [0, 1, 4].includes(index),
  displayOrder: index,
  createdAt: index === 0 ? '2026-01-11T00:00:00.000Z' : '2026-01-13T00:00:00.000Z',
}))

const folders: FriendAttributesFolderView[] = [
  { id: '', name: 'すべて', count: 101, color: '#18ae72' },
  { id: 'qa-vip', name: 'VIP', count: 8, color: '#f29b22' },
  { id: 'qa-pet', name: 'ペット', count: 6, color: '#e84d93' },
  { id: 'qa-member', name: '会員', count: 8, color: '#18ae72' },
  { id: 'qa-health', name: '健康', count: 8, color: '#25a7c2' },
  { id: 'qa-purchase', name: '購入', count: 9, color: '#4379ee' },
  { id: '__ungrouped__', name: '未分類', count: 11, color: '#a2a8ad' },
]

const rows: FriendAttributesRowView[] = [
  { id: 'qa-0', tag: 'EC顧客連携済み', folderId: 'qa-purchase', folder: '購入', folderColor: '#4379ee', count: '5人', source: 'EC連携', links: [{ label: '本人+10', tone: 'green' }, { label: '1.2倍', tone: 'orange' }, { label: '他1', tone: 'gray' }], usage: '配信3・フォーム1', date: '2026/01/11', starred: true, editHref: '/tags/edit?id=qa-0' },
  { id: 'qa-1', tag: 'LINEログイン連携済み', folderId: 'qa-member', folder: '会員', folderColor: '#18ae72', count: '5人', source: 'LINE Login', links: [], usage: 'シナリオ2', date: '2026/01/13', starred: true, editHref: '/tags/edit?id=qa-1' },
  { id: 'qa-2', tag: 'NEN会員', folderId: 'qa-member', folder: '会員', folderColor: '#18ae72', count: '5人', source: '回答フォーム', links: [{ label: '本人+10', tone: 'green' }, { label: '紹介+5', tone: 'green' }, { label: '1.5倍', tone: 'orange' }, { label: '他3', tone: 'gray' }], usage: '配信4', date: '2026/01/13', starred: false, editHref: '/tags/edit?id=qa-2' },
  { id: 'qa-3', tag: '商品到着確認対象', folderId: 'qa-purchase', folder: '購入', folderColor: '#4379ee', count: '3人', source: 'EC購入', links: [{ label: '本人+3', tone: 'green' }, { label: '他1', tone: 'gray' }], usage: '自動応答1', date: '2026/01/13', starred: false, editHref: '/tags/edit?id=qa-3' },
  { id: 'qa-4', tag: '未契約', folderId: '', folder: '未分類', folderColor: '#a2a8ad', count: '3人', source: '手動', links: [], usage: '保存検索2', date: '2026/01/13', starred: true, editHref: '/tags/edit?id=qa-4' },
  { id: 'qa-5', tag: '誕生日クーポン対象', folderId: 'qa-vip', folder: 'VIP', folderColor: '#f29b22', count: '0人', source: '誕生日ルール', links: [{ label: '本人+20', tone: 'green' }, { label: '他2', tone: 'gray' }], usage: '配信1', date: '2026/01/13', starred: false, editHref: '/tags/edit?id=qa-5' },
]

export default function FriendAttributesV3Static() {
  return <FriendAttributesView kpis={[
    { label: 'タグ数', value: '101件', note: '未使用 78件' },
    { label: '付与済み友だち', value: '5人', note: '1つ以上付与' },
    { label: '今月の付与', value: '78回', note: '手動・自動' },
    { label: '整理候補', value: '80件', note: '未使用・重複名' },
  ]} folders={folders} rows={rows} totalCount={101} filteredCount={101} rangeStart={1} rangeEnd={20} activeFolderId="" query="" usageFilter="all" sourceFilter="all" quickFilter="unused" pageSize={20} currentPage={1} totalPages={12} />
}

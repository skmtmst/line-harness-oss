/**
 * 一覧の名前整形と「回答が新しい順」の規則。
 *
 * 正本は @line-crm/shared（#1060: サーバー側ページングで Worker も同じ
 * 並び・絞り込みをするため、規則を1か所に寄せた）。
 */
export {
  displayFormName,
  sortFormsByLatestAnswer,
} from '@line-crm/shared'

/** @deprecated 互換のため残す。新規は @line-crm/shared の FormListItemLike を使う。 */
export interface SortableForm {
  id: string
  name: string
  createdAt: string
  lastSubmittedAt: string | null
}

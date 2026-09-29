/**
 * 一覧で「答えると何が書き換わるか」を数える規則。
 *
 * 正本は @line-crm/shared（#1060: 一覧のページ分けを Worker 側へ寄せたため、
 * 「情報欄に保存している」の判定を画面とAPIで共有する）。
 */
export {
  hasStoredDestination,
  summarizeFormDestinations,
  type FormDestinationSummary,
} from '@line-crm/shared'

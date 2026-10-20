// この機能が外へ公開する名前。機能内では宣言元を直接読む。
export { default as RestaurantDashboard } from './entry'
export { canWriteRole, groupCloseTasks, openItems, reasonText, slotTitle, canMarkVisited, summarizeToday, visitState } from './summarize'
export type { CloseGroup } from './summarize'
export { loadStoreMedia, useStoreToday } from './use-store-today'
export type { StoreMedium, StoreToday } from './use-store-today'

// この機能が外へ公開する名前。機能内では宣言元を直接読む。
export { default as HomeDashboard } from './home'
export { default as StyleDashboard } from './style-dashboard'
// スタイル体験の見本（onboarding）が、業種ダッシュボードと同じ部品・言葉で縮めた画面を描くための名前。
export { STYLE_CONFIG } from './config'
export { TodayList, type Column as TodayListColumn } from './today-list'
export { SideCard } from './parts'
export { StaffBoard } from './staff-board'
export { styleMetricLabel } from './metric-selection'
export type { StyleBoard, StyleRow, StyleSideCard } from './model'

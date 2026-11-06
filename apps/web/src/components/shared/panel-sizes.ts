export const DIALOG_WIDTHS = [480, 560, 720, 960] as const
export const DRAWER_WIDTHS = [480, 540] as const
export const DETAIL_PANEL_WIDTH = 360
/** 内容を切らないよう、指定を入れられる最小の段へ上げる。 */
export const dialogWidth = (requested = 560): number => DIALOG_WIDTHS.find((width) => width >= requested) ?? 960
export const drawerWidth = (requested = 480): number => requested <= 480 ? 480 : 540

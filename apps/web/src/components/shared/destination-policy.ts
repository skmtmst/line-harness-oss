/** B-177: 行き先の形と幅は共通部品が持つ。 */
export const DIALOG_WIDTHS = [480, 560, 720, 960] as const
export const CONFIRM_WIDTH = 480
export const PICKER_WIDTH = 640
export function dialogWidth(width = 560): number {
  return DIALOG_WIDTHS.reduce<number>((best, candidate) =>
    Math.abs(candidate - width) < Math.abs(best - width) ? candidate : best, DIALOG_WIDTHS[0])
}

export function drawerWidth(width = 480): number {
  return Math.abs(width - 480) <= Math.abs(width - 540) ? 480 : 540
}

/** 子の操作・選択・文字の選択は行を開く操作にしない。 */
export function isRowControl(target: EventTarget | null, row: HTMLElement): boolean {
  return target instanceof Element && Boolean(target.closest('a,button,input,select,textarea,label,summary,[role="button"],[role="menu"],[role="checkbox"],[role="combobox"],[contenteditable="true"]')) && target !== row
}

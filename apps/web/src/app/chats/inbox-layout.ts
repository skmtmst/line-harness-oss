/** M0393: 白い板の内幅で3列／顧客情報の重ね合わせを切り替える。 */
export const INBOX_LIST_WIDTH = 340
export const INBOX_INFO_PANEL_WIDTH = 260
export const INBOX_TALK_MIN_WIDTH = 500
export const INBOX_INFO_PANEL_MIN_WIDTH = INBOX_LIST_WIDTH + INBOX_INFO_PANEL_WIDTH + INBOX_TALK_MIN_WIDTH
export function inboxThreeColumnsFit(boardWidth: number): boolean {
  return boardWidth >= INBOX_INFO_PANEL_MIN_WIDTH
}

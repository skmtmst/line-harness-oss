/* 予約台帳の数の帯と下の段の左右端を測る（page.evaluate で動く）。 */
export default function scan() {
  const band = document.querySelector('[data-shared-part="kpi-band"]')
  if (!band) return { error: 'no-band' }
  const board = document.querySelector('[role="region"][aria-label$="の時間×卓"]')
  if (!board) return { error: 'no-board' }
  const nextCard = document.querySelector('[aria-labelledby="rs-next-title"]')
  const side = nextCard ? nextCard.parentElement : null
  const bandRect = band.getBoundingClientRect()
  const boardRect = board.getBoundingClientRect()
  let rightRef = boardRect
  let sideVisible = false
  if (side) {
    const sideRect = side.getBoundingClientRect()
    if (sideRect.width > 0 && getComputedStyle(side).display !== 'none') {
      rightRef = sideRect
      sideVisible = true
    }
  }
  return {
    bandLeft: bandRect.left,
    bandRight: bandRect.right,
    lowerLeft: boardRect.left,
    lowerRight: rightRef.right,
    sideVisible,
    dLeft: bandRect.left - boardRect.left,
    dRight: bandRect.right - rightRef.right,
  }
}

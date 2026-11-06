/** Read the rendered common preview in either a page or a dialog. */
export function measureInitialMenuLayout() {
  return [...document.querySelectorAll('[data-initial-menu-preview]')]
    .filter(preview => preview.getClientRects().length > 0)
    .map(preview => {
      const image = preview.querySelector('[data-initial-menu-image]')
      const card = image?.closest('section')?.getBoundingClientRect()
      const destination = preview.querySelector('[data-initial-menu-destinations]')?.getBoundingClientRect()
      const bounds = preview.getBoundingClientRect()
      return {
        width: bounds.width,
        imageWidth: image?.getBoundingClientRect().width ?? 0,
        imageReady: Boolean(image?.complete && image.naturalWidth === 2500),
        overflow: Math.max(document.documentElement.scrollWidth - innerWidth, preview.scrollWidth - preview.clientWidth),
        beside: Boolean(card && destination && Math.abs(card.top - destination.top) < 2 && destination.left >= card.right),
        gap: card && destination ? destination.left - card.right : null,
      }
    })
}

/** The generated PNG uses 66px labels on a 2500px canvas. */
export function initialMenuLayoutFailures(previews) {
  const failures = []
  if (!previews.length) failures.push('initial menu preview is missing')
  for (const preview of previews) {
    if (preview.width <= 0) failures.push('initial menu preview has collapsed')
    if (!preview.imageReady) failures.push('initial menu image is not loaded')
    if (preview.imageWidth * 66 / 2500 < 12) failures.push('initial menu labels are smaller than 12px')
    if (preview.overflow > 0) failures.push('initial menu preview overflows horizontally')
    if (preview.width >= 800 && (!preview.beside || preview.gap > 32)) failures.push('initial menu explanation leaves unused space beside the image')
  }
  return failures
}

import { expect } from '@playwright/test'

/** Dialog first renders inline, then moves to the body portal. Use the final surface. */
export async function waitForOverlayLayout(dialog) {
  await expect.poll(() => dialog.evaluate(element =>
    element.closest('[role="presentation"]')?.parentElement === document.body,
  ), { timeout: 15000 }).toBe(true)
  await dialog.evaluate(async element => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const finite = element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
    await Promise.allSettled(finite.map(animation => animation.finished))
  })
}

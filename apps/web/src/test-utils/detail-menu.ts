import { fireEvent, screen } from '@testing-library/react'

/** 詳細面の操作帯を実際に開き、同じ操作の確認・権限・失敗の試験を続ける。 */
export async function findDetailMenuItem(name: string | RegExp, surface?: ParentNode): Promise<HTMLElement> {
  const panel = surface ?? document.querySelector('[data-design-part="detail-panel"], [data-design-part="drawer"], [data-detail-preview]')
  const trigger = panel?.querySelector<HTMLButtonElement>('footer [data-row-menu]')
  if (!trigger) throw new Error('詳細の操作帯にメニューがありません')
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger)
  return screen.findByRole('menuitem', { name })
}

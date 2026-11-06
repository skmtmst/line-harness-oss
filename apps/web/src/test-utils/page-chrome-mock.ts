import { vi } from 'vitest'

/** 単独で画面をmountする試験にも、現役のページ名とパンくずの口を用意する。 */
export function pageChromeMock() {
  return {
    usePageTitle: vi.fn(), usePageCrumbs: vi.fn(), useFullWidthPage: vi.fn(),
    useSettingsNavInline: vi.fn(), useHideSettingsNav: vi.fn(),
  }
}

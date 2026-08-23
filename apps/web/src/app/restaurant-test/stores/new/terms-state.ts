import { TERMS_DOCUMENT } from '@/content/terms/musubo-terms'

export const STEP = {
  TERMS: 1,
  BASICS: 2,
  OFFICIAL_ACCOUNT: 3,
  CREDENTIALS: 4,
  CONNECT: 5,
} as const

export const TERMS_SCROLL_TOLERANCE_PX = 8

export type ScrollMetrics = {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

export function hasReadTerms(metrics: ScrollMetrics): boolean {
  const noScrollNeeded = metrics.scrollHeight <= metrics.clientHeight + TERMS_SCROLL_TOLERANCE_PX
  const reachedBottom = metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - TERMS_SCROLL_TOLERANCE_PX
  return noScrollNeeded || reachedBottom
}

export function canSubmitTerms(readToEnd: boolean, checked: boolean): boolean {
  return readToEnd && checked
}

export function initialWizardStep(agreedVersion: string | null): number {
  return agreedVersion === TERMS_DOCUMENT.version ? STEP.BASICS : STEP.TERMS
}

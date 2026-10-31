export type SetupStepLayout = { width: number; gap: number; rows: Array<{ width: number; height: number; overflow: number; labelOverflow: number; helpGap?: number | null }> }
export function measureSetupStepLayout(): SetupStepLayout[]
export function setupStepLayoutFailures(lists: SetupStepLayout[]): string[]

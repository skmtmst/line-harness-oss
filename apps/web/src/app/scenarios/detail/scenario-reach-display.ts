export function scenarioReachCountLabel(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? `${Math.floor(value)}人`
    : '—'
}

export function scenarioReachPercent(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return null
  }

  return Math.round(value * 100)
}

export function scenarioReachPercentLabel(value: number | null): string {
  return value === null ? '—' : `${value}%`
}

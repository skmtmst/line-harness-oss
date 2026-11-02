type ScenarioAccountRow = { id: string; lineAccountId: string | null }

export function scenarioAccountTargets(ids: string[], rows: ScenarioAccountRow[]) {
  const rowsById = new Map(rows.map(row => [row.id, row]))
  const targets = ids.map(id => rowsById.get(id))
  const allAccounts = targets.some(row => row?.lineAccountId === null)
  const accountIds = [...new Set(targets.filter(row => row?.lineAccountId !== null).map(row => row?.lineAccountId ?? ''))]
  return { accounts: allAccounts ? [] : accountIds.map(id => ({ id })), allAccounts }
}

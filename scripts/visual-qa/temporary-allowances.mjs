import { readFileSync } from 'node:fs'

const DEFAULT_FILE = new URL('./train16-temporary-allowances.json', import.meta.url)

// 生の結果は呼出元に残す。一時許可は同じ対象・同じ値・同じ件数だけに効く。
export const patternFindingKey = hit => JSON.stringify([
  hit.category, hit.pattern, hit.file, hit.kind ?? hit.signal,
  hit.text.replace(/\s+/g, ' ').trim(),
])
export const skeletonFindingKey = hit => JSON.stringify([hit.route, hit.width, hit.failure])

export function applyTemporaryAllowances(findings, entries, key = value => value, today = new Date().toISOString().slice(0, 10)) {
  const remaining = new Map()
  for (const entry of entries) {
    if (typeof entry.match !== 'string' || !entry.match.trim() || remaining.has(entry.match)
      || !Number.isInteger(entry.count) || entry.count < 1
      || typeof entry.reason !== 'string' || !entry.reason.trim()
      || typeof entry.owner !== 'string' || !entry.owner.trim()
      || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires ?? '')
      || !Number.isFinite(Date.parse(entry.expires))
      || new Date(entry.expires).toISOString().slice(0, 10) !== entry.expires) {
      throw new Error('一時許可の対象・件数・理由・担当・期限が不正です')
    }
    if (entry.expires < today) throw new Error(`一時許可の期限切れ: ${entry.match}`)
    remaining.set(entry.match, { entry, count: entry.count })
  }
  const allowed = [], unexpected = []
  for (const finding of findings) {
    const permit = remaining.get(key(finding))
    if (!permit?.count) { unexpected.push(finding); continue }
    permit.count -= 1
    allowed.push({ finding, reason: permit.entry.reason, owner: permit.entry.owner, expires: permit.entry.expires })
  }
  return { allowed, unexpected }
}

export function checkTemporaryAllowances(section, findings, key) {
  const data = JSON.parse(readFileSync(DEFAULT_FILE, 'utf8'))
  if (data.version !== 1 || !Array.isArray(data[section])) throw new Error(`一時許可の形式が不正です: ${section}`)
  return applyTemporaryAllowances(findings, data[section], key)
}

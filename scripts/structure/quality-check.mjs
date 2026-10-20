import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { qualityInventory, compareInventory } from './quality-inventory.mjs'
import { repositoryFiles, packageRoots, baselinePath } from './repository-files.mjs'

// 初回の負債は依頼で指定された整理済みの土台から測る。以後はPRのbaseにある一覧だけを使う。
const initialQualitySource = '845f200c0b5d74e51fcd638b06d2552c5b038383'
export function checkQuality(root, base, update = false) {
  if (!base) throw Error('quality check requires --base <trusted PR base SHA>')
  // 初回導入でも、存在しないbaseを現在の値で代用しない。
  execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], { cwd: root, stdio: 'pipe' })
  const current = qualityInventory(repositoryFiles(root), packageRoots(root))
  const existsAtBase = execFileSync('git', ['ls-tree', '--name-only', base, baselinePath], { cwd: root, encoding: 'utf8' }).trim()
  if (!existsAtBase) execFileSync('git', ['merge-base', '--is-ancestor', initialQualitySource, 'HEAD'], {cwd: root, stdio: 'pipe'})
  const previous = existsAtBase ? JSON.parse(execFileSync('git', ['show', `${base}:${baselinePath}`], { cwd: root, encoding: 'utf8' }))
    : qualityInventory(repositoryFiles(root, initialQualitySource), packageRoots(root, initialQualitySource)).counts
  const baseline = update ? current.counts : JSON.parse(readFileSync(resolve(root, baselinePath), 'utf8'))
  const errors = compareInventory(current.counts, baseline, previous)
  if (update && !errors.length) writeFileSync(resolve(root, baselinePath), JSON.stringify(baseline, null, 2) + '\n')
  return { base, baselineSource: existsAtBase ? base : initialQualitySource, previousCounts: previous, ...current, errors }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--base'), base = index < 0 ? process.env.QUALITY_BASE_SHA : process.argv[index + 1]
  const report = checkQuality(process.cwd(), base, process.argv.includes('--update'))
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(JSON.stringify(report.counts, null, 2))
    for (const error of report.errors) console.error(error)
    if (report.errors.length) for (const hit of report.findings) if (report.errors.some(error => error.startsWith(hit.rule + ':'))) console.error(`${hit.rule}: ${hit.file}:${hit.line} ${hit.detail.slice(0, 180)}`)
  }
  if (report.errors.length) process.exitCode = 1
}

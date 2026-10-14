import { writeFileSync } from 'node:fs'
import { readWorkingTree, isBodySource, lineCount, functionLengths } from './code-size.mjs'

const files = [...readWorkingTree(process.cwd())].filter(([path, source]) => isBodySource(path, source))
const functions = files.flatMap(([path, source]) => functionLengths(path, source))
const distribution = values => {
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = fraction => sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0
  return { count: sorted.length, median: percentile(0.5), p75: percentile(0.75), p90: percentile(0.9), p95: percentile(0.95), p99: percentile(0.99), max: sorted.at(-1) ?? 0,
    over: Object.fromEntries([80, 120, 200, 400, 800].map(limit => [limit, sorted.filter(length => length > limit).length])) }
}
const report = {
  files: distribution(files.map(([, source]) => lineCount(source))),
  functionsFull: distribution(functions.map(fn => fn.full)),
  functionsBody: distribution(functions.map(fn => fn.body)),
  componentsBody: distribution(functions.filter(fn => fn.component).map(fn => fn.body)),
  largest: functions.sort((a, b) => b.body - a.body).slice(0, 50),
}
writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ files: report.files.count, functions: report.functionsBody.count, components: report.componentsBody.count }))

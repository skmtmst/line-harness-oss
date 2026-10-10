/** PERF-01: unchanged production fixtures and speed measurement, plus separate CDP diagnosis. */
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { measureScreen, measureStress, median } from './speed-budget.mjs'
import { mockFetch } from './mock-local.mjs'

const [base = 'http://127.0.0.1:4393', out = '/tmp/perf3-before', rateArg = '1'] = process.argv.slice(2)
const rate = Number(rateArg)
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const target = { stub: true, mockFetch, url: route => new URL(route, base).href }
const results = []
const phases = process.env.PERF3_DIAGNOSE === '0' ? [false] : process.env.PERF3_DIAGNOSE === 'only' ? [true] : [false, true]
const checkpoint = () => writeFileSync(join(out, 'results.json'), `${JSON.stringify({ complete: results.length === phases.length * 2, rate, viewport: [1440,900], samples: 3, results }, null, 2)}\n`)
checkpoint()
function unionMs(events) {
  const spans = events.filter(e => e.ph === 'X' && e.dur > 0).map(e => [e.ts, e.ts + e.dur]).sort((a, b) => a[0] - b[0])
  let total = 0, end = -Infinity
  for (const [a, b] of spans) { total += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b) }
  return Math.round(total / 100) / 10
}
function summarize(events, profile) {
  const counts = new Map()
  for (const e of events) if (e.name === 'FunctionCall') counts.set(`${e.pid}:${e.tid}`, (counts.get(`${e.pid}:${e.tid}`) ?? 0) + (e.dur ?? 0))
  const thread = [...counts].sort((a,b) => b[1] - a[1])[0]?.[0]
  const main = events.filter(e => `${e.pid}:${e.tid}` === thread)
  const category = names => unionMs(main.filter(e => names.includes(e.name)))
  const self = new Map()
  const nodes = new Map(profile.nodes.map(n => [n.id, n.callFrame]))
  for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
    const frame = nodes.get(profile.samples[i])
    const key = `${frame.functionName || '(anonymous)'} ${frame.url?.split('/').pop() ?? ''}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`
    self.set(key, (self.get(key) ?? 0) + profile.timeDeltas[i] / 1000)
  }
  return {
    scriptMs: category(['FunctionCall', 'EvaluateScript', 'RunMicrotasks']),
    renderingMs: category(['Layout', 'UpdateLayoutTree', 'Paint', 'PrePaint']),
    eventMs: category(['EventDispatch']),
    layoutMs: category(['Layout']),
    topTasks: main.filter(e => e.name === 'RunTask' && e.ph === 'X').sort((a,b) => b.dur - a.dur).slice(0, 5).map(e => ({ start: e.ts, ms: e.dur / 1000, children: main.filter(c => c.ph === 'X' && c.ts >= e.ts && c.ts + (c.dur ?? 0) <= e.ts + e.dur && ['FunctionCall', 'Layout', 'UpdateLayoutTree', 'EventDispatch', 'RunMicrotasks', 'EvaluateScript'].includes(c.name)).map(c => ({ name: c.name, ms: c.dur / 1000, data: c.args?.data })).sort((a,b) => b.ms - a.ms).slice(0,8) })),
    topCpu: [...self].sort((a,b) => b[1] - a[1]).slice(0,25).map(([frame, ms]) => ({ frame, ms: Math.round(ms * 10) / 10 })),
  }
}
try {
  for (const diagnostic of phases) {
    for (const name of ['tags', 'friends-2000']) {
      const samples = []
      for (let i = 0; i < 3; i++) {
        let diagnosis
        const wrapped = { newPage: async options => {
          const page = await browser.newPage(options)
          const cdp = await page.context().newCDPSession(page)
          await cdp.send('Emulation.setCPUThrottlingRate', { rate })
          const slowTask = Number(process.env.PERF3_LONG_TASK_MS ?? 0)
          if (slowTask > 0) await page.addInitScript(ms => {
            addEventListener('DOMContentLoaded', () => setTimeout(() => {
              const end = performance.now() + ms
              while (performance.now() < end) { /* Negative control: a real browser long task. */ }
            }, 350), { once: true })
          }, slowTask)
          if (diagnostic) {
            await page.addInitScript(() => {
              window.__aggregateCalls = { filter: { calls: 0, ms: 0 }, reduce: { calls: 0, ms: 0 } }
              for (const name of ['filter', 'reduce']) {
                const original = Array.prototype[name]
                Array.prototype[name] = function (...args) {
                  const start = performance.now()
                  try { return Reflect.apply(original, this, args) }
                  finally { window.__aggregateCalls[name].calls++; window.__aggregateCalls[name].ms += performance.now() - start }
                }
              }
            })
            const events = []
            cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value))
            await cdp.send('Profiler.enable')
            await cdp.send('Profiler.setSamplingInterval', { interval: 500 })
            await cdp.send('Profiler.start')
            await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' })
            const close = page.close.bind(page)
            page.close = async (...args) => {
              const { profile } = await cdp.send('Profiler.stop')
              const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve))
              await cdp.send('Tracing.end')
              await complete
              diagnosis = summarize(events, profile)
              diagnosis.aggregation = await page.evaluate(() => window.__aggregateCalls)
              // reduce callbacks also include native-table geometry reads; retain those raw times separately.
              diagnosis.aggregationMs = diagnosis.aggregation.filter.ms
              writeFileSync(join(out, `${name}-${i}-trace.json`), JSON.stringify({ traceEvents: events }))
              writeFileSync(join(out, `${name}-${i}-cpu.json`), JSON.stringify(profile))
              await close(...args)
            }
          }
          return page
        } }
        const metrics = name === 'tags' ? await measureScreen(wrapped, target, 'tags', '/tags') : await measureStress(wrapped, target)
        samples.push({ ...metrics, ...(diagnosis ? { diagnosis } : {}) })
        console.log(`${diagnostic ? 'diagnosis' : 'clean'} ${name} ${i + 1}: ${JSON.stringify(metrics)}`)
      }
      const metrics = ['showMs', 'longTaskMs', 'pressMs', 'lcpMs', 'jsBytes']
      results.push({ name, diagnostic, median: Object.fromEntries(metrics.map(k => [k, median(samples.map(s => s[k]))])), ...(diagnostic ? { diagnosisMedian: Object.fromEntries(['scriptMs','renderingMs','eventMs','layoutMs','aggregationMs'].map(k => [k, median(samples.map(s => s.diagnosis[k]))])) } : {}), samples })
      checkpoint()
    }
  }
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally { await browser.close() }

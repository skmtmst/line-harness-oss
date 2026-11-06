import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { paymentGet, paymentWrite } from './payment-fixtures.mjs'
import { styleDashboardMock } from './style-dashboard-mock.mjs'
import { styleSetupRead, styleSetupWrite } from './style-setup-fixtures.mjs'

type Sample = { api: 'styleApi' | 'bookingPaymentAdminApi'; method: string; value: unknown }

/** Compile serialized runtime responses against the public API, without importing browser code at runtime.
 * No copied response interfaces or casts: missing fields and unknown enum values must fail here.
 */
function diagnostics(samples: Sample[]) {
  const filename = fileURLToPath(new URL('./__fixture_contract__.ts', import.meta.url))
  const source = samples.map(({ api, method, value }, index) => {
    const module = api === 'styleApi' ? 'api-styles' : 'api-booking-payment-admin'
    return `const sample${index}: Awaited<ReturnType<typeof import('../../apps/web/src/lib/${module}').${api}.${method}>> = ${JSON.stringify(value)};`
  }).join('\n')
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: fileURLToPath(new URL('../../apps/web', import.meta.url)), paths: { '@/*': ['./src/*'] },
  }
  const host = ts.createCompilerHost(options)
  const originalRead = host.readFile
  host.readFile = path => path === filename ? source : originalRead(path)
  const program = ts.createProgram([filename], options, host)
  const file = program.getSourceFile(filename)
  if (!file) throw new Error('fixture contract source was not compiled')
  const missingModules = program.getSemanticDiagnostics().filter(diagnostic => diagnostic.code === 2307)
  return [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file), ...missingModules]
    .map(diagnostic => `${diagnostic.start === undefined || !diagnostic.file ? '' : diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)
}

const query = new URLSearchParams({ style: 'restaurant', date: '2026-10-15' })

describe('P04 QA fixtures use the current public API types', () => {
  it('支払い・初期設定・4業種の日週月・空の状態が現在のAPI型と一致する', () => {
    const samples: Sample[] = []
    for (const [method, path] of [
      ['records', '/api/booking/admin/payments'], ['events', '/api/booking/admin/payment-events'],
      ['connection', '/api/booking/admin/payment-connection'], ['menuOverrides', '/api/booking/admin/menu-payments'],
      ['staffTodayCounts', '/api/booking/admin/staff/today-counts'],
      ['refunds', '/api/booking/payments/pay-1/refunds'],
      ['courseMode', '/api/restaurant-test/menus/menu-1/payment'],
      ['eventMode', '/api/events/admin/events/event-1/payment'],
    ]) samples.push({ api: 'bookingPaymentAdminApi', method, value: paymentGet(path, query) })
    samples.push({ api: 'bookingPaymentAdminApi', method: 'previewPaymentLink', value: paymentWrite('POST', '/api/booking/admin/payments/pay-1/send-link', {}) })
    for (const notifyLine of [false, true]) samples.push({ api: 'bookingPaymentAdminApi', method: 'refund', value: paymentWrite('POST', '/api/booking/payments/pay-1/refund', { amount: 500, reason: '見本の返金', notifyLine, idempotencyKey: 'qa-refund' }) })
    samples.push({ api: 'bookingPaymentAdminApi', method: 'replayEvent', value: paymentWrite('POST', '/api/booking/admin/payment-events/pe-5/replay', {}) })
    for (const [method, path] of [
      ['warnings', '/warnings'], ['starterSet', '/starter-set'], ['starterItems', '/starter-items'],
      ['templateSamples', '/template-samples'], ['resources', '/resources'],
    ]) samples.push({ api: 'styleApi', method, value: styleSetupRead('GET', `/api/dashboard/style${path}`, query) })
    samples.push({ api: 'styleApi', method: 'activate', value: { success: true, data: styleSetupWrite('POST', '/api/dashboard/style/activate') } })
    for (const style of ['restaurant', 'salon', 'consult', 'lesson']) {
      for (const qaEmpty of [false, true]) {
        samples.push({ api: 'styleApi', method: 'save', value: styleDashboardMock('PUT', '/api/dashboard/style', query, { style, qaEmpty }) })
        samples.push({ api: 'styleApi', method: 'get', value: styleDashboardMock('GET', '/api/dashboard/style', query) })
        for (const range of ['today', 'week', 'month']) {
          const params = new URLSearchParams({ style, range, date: '2026-10-15' })
          for (const method of ['summary', 'schedule', 'analytics']) {
            samples.push({ api: 'styleApi', method, value: styleDashboardMock('GET', `/api/dashboard/style/${method}`, params) })
          }
        }
      }
    }
    expect(diagnostics(samples)).toEqual([])
  }, 30000)

  it('必須項目の欠落・未知の支払い状態・送信成功への偽装を拒否する', () => {
    const broken = [
      { api: 'bookingPaymentAdminApi', method: 'records', value: { success: true, data: { items: [], total: 0 } } },
      { api: 'bookingPaymentAdminApi', method: 'events', value: { success: true, data: { items: [{ id: 'event-1', receivedAt: '2026-10-15T12:52:00.000Z', kind: 'paid', amount: null, repeat: false, bookingId: null, bookingLabel: null, note: null, result: 'unknown' }], total: 1 } } },
      { api: 'bookingPaymentAdminApi', method: 'previewPaymentLink', value: { success: true, data: { paymentId: 'pay-1', checkoutUrl: null, sent: true, simulation: false } } },
      { api: 'bookingPaymentAdminApi', method: 'refund', value: { success: true, data: { payment: { status: 'refunded' } } } },
    ] satisfies Sample[]
    const errors = diagnostics(broken)
    for (let line = 1; line <= broken.length; line++) expect(errors.some(error => error.startsWith(`${line}:`))).toBe(true)
  }, 30000)
})

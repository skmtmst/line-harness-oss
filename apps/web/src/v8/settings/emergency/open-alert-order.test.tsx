// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { OpenAlerts } from './health'
import type { OperationAlert } from '@/lib/api'

afterEach(cleanup)
it('重要度が高い異常を先に、同じ重要度は新しい順に並べる', () => {
 const make = (id: string, severity: OperationAlert['severity'], lastDetectedAt: string) => ({ id, severity, lastDetectedAt, firstDetectedAt:lastDetectedAt, summary:id, checkKey:'webhook',status:'open',events:[],notification:{queued:0,sending:0,sent:0,failed:0,unconfigured:0,total:0} }) as OperationAlert
 const alerts = [make('新しい注意','warning','2026-11-03T09:00:00Z'),make('古いエラー','danger','2026-11-01T09:00:00Z'),make('新しいエラー','danger','2026-11-02T09:00:00Z')]
 render(<OpenAlerts alerts={alerts} failed={false} busyId={null} canManage={false} onAcknowledge={vi.fn()} onRetry={vi.fn()} />)
 const section=screen.getByRole('region',{name:'開いている異常'})
 const rows=within(section).getAllByText(/新しい注意|古いエラー|新しいエラー/).map(el=>el.textContent)
 expect(rows[0]).toContain('新しいエラー'); expect(rows[1]).toContain('古いエラー'); expect(rows[2]).toContain('新しい注意')
 expect(alerts[0].summary).toBe('新しい注意')
})

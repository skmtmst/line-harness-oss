import { expect, it } from 'vitest'
import { overviewBandCells } from './shell'
it('WEB-025：集計の数え方を変えず直近30日と表示する', () => {
  const cells = overviewBandCells({ outgoing: [], incomingCount: 2, summary: { outgoing: 10, outgoingFailed: 1, failed: 1, incoming: 3 } as never })
  expect(cells.find(c => c.key === 'sent')).toMatchObject({ title: '直近30日 送った', value: 10 })
  expect(cells.find(c => c.key === 'incoming')?.detail).toBe('直近30日 3 回')
})

// @vitest-environment happy-dom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {EditReservationDialog} from './dialogs'
import {reservation} from '../booking-kit/test-data'
afterEach(cleanup)
it('OP-R05 日時を変えず保存しても端末の時間帯で予約を動かさない', async()=>{
 const onSave=vi.fn()
 render(<EditReservationDialog reservation={reservation('synthetic',{customer_name:'人工のお客さま',starts_at:'2026-10-20T09:00:00.000Z',ends_at:'2026-10-20T11:00:00.000Z'})} tables={[]} courses={[]} busy={false} canWrite onClose={()=>{}} onSave={onSave} onCancelReservation={()=>{}} onRestore={()=>{}}/>)
 fireEvent.click(screen.getByRole('button',{name:'保存する'}))
 await waitFor(()=>expect(onSave).toHaveBeenCalledTimes(1))
 expect(onSave.mock.calls[0][0]).toMatchObject({startsAt:'2026-10-20T09:00:00.000Z',endsAt:'2026-10-20T11:00:00.000Z'})
})

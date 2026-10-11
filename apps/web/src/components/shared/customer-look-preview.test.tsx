// @vitest-environment happy-dom
import {afterEach,expect,test} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {DEFAULT_CUSTOMER_LOOK} from '@line-crm/shared'
import CustomerLookPreview from './customer-look-preview'
import styles from './customer-look-preview.module.css'
afterEach(cleanup)
test('予約の見本の選択日・時刻と確認文は一致し、タブを戻しても一致する',()=>{
 const {container,rerender}=render(<CustomerLookPreview look={DEFAULT_CUSTOMER_LOOK} accountName="見本の店"/> )
 const check=()=>{
  const selected=container.querySelector(`.${styles.week} [data-selected]`)
  const date=selected?.querySelector('strong')?.textContent
  const weekday=selected?.firstChild?.textContent
  const time=container.querySelector(`.${styles.times} [data-selected]`)?.textContent
  expect(date).toBeTruthy();expect(weekday).toBeTruthy();expect(time).toBeTruthy()
  const expected=`10月${date}日（${weekday}）${time}`
  expect(container.querySelector(`.${styles.footer} p`)?.textContent).toBe(expected)
  return expected
 }
 const expected=check()
 fireEvent.click(screen.getByRole('tab',{name:'予約の履歴'}))
 expect(screen.getByText(expected)).toBeTruthy()
 fireEvent.click(screen.getByRole('tab',{name:'予約',exact:true}))
 rerender(<CustomerLookPreview look={{...DEFAULT_CUSTOMER_LOOK,preset:'natural'}} accountName="見本の店"/> )
 check()
})

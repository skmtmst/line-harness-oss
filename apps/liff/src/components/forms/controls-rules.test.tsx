// @vitest-environment happy-dom
import React from 'react'
import {render,screen,cleanup,fireEvent} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {LiffInput,LiffTextArea,LiffFieldLabel} from './controls'
import Button from '../ui/Button'
afterEach(cleanup)
it('LIFF の必須は札、任意は括弧と重ねない',()=>{
 const {container}=render(<><LiffFieldLabel htmlFor="name" label="お名前＊" required/><LiffInput id="name"/><LiffFieldLabel htmlFor="note" label="ご要望（任意）" optional/><LiffTextArea id="note"/></>)
 expect(container.textContent?.match(/任意/g)).toHaveLength(1);expect(container.textContent?.match(/必須/g)).toHaveLength(1);expect(container.textContent).not.toContain('＊');expect(screen.getByLabelText('ご要望')).toBeTruthy();expect(screen.getByLabelText('お名前')).toBeTruthy()
})
it('共通の欄とボタンは入力途中・選択・押せない状態の動きを保つ',()=>{
 const edit=vi.fn(),save=vi.fn();render(<><LiffInput aria-label="暗証番号" type="password" inputMode="numeric" value="0012" onChange={edit}/><Button disabled onClick={save}>保存</Button></>)
 const input=screen.getByLabelText('暗証番号') as HTMLInputElement;expect(input.value).toBe('0012');fireEvent.change(input,{target:{value:'0000'}});expect(edit).toHaveBeenCalled();fireEvent.click(screen.getByRole('button'));expect(save).not.toHaveBeenCalled()
})

it('補助の日付・添付とPINは共通の欄で隠し、選択中の人数は共通ボタンが示す',()=>{
 const {container}=render(<><LiffInput aria-label="別の日" type="date" appearance="concealed"/><LiffInput aria-label="PIN" type="password" appearance="pin"/><Button variant="chip" role="radio" aria-checked={true}>2名</Button></>)
 expect(screen.getByLabelText('別の日').className).toContain('concealedInput');expect(screen.getByLabelText('PIN').className).toContain('pinInput');expect(screen.getByRole('radio',{name:'2名'}).getAttribute('aria-checked')).toBe('true');expect(screen.getByRole('radio',{name:'2名'}).getAttribute('data-selected')).toBe('true');expect(container.querySelector('input[type=password]')).toBeTruthy()
})

// @vitest-environment happy-dom
import React from 'react'
import {render,screen,cleanup,fireEvent} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import NumberField,{numberRangeNote} from './number-field'
import {Field} from './form-controls'
afterEach(cleanup)
it('単位は入力値の外、範囲は共通の補足で出す',()=>{
 const change=vi.fn();const {container}=render(<Field label="個数" required><NumberField value="12" unit="個" min={1} max={23} onChange={change}/></Field>)
 const input=screen.getByRole('spinbutton',{name:'個数'}) as HTMLInputElement
 expect(input.value).toBe('12');expect(container.querySelector('[data-number-unit]')?.textContent).toBe('個');expect(screen.getByText('1〜23')).toBeTruthy();expect(numberRangeNote(1,23)).toBe('1〜23');expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(container.querySelector('[data-number-unit]')?.id)
 fireEvent.change(input,{target:{value:''}});expect(change).toHaveBeenCalled();expect(input.getAttribute('aria-required')).toBe('true')
})
it('数字の文字入力では入力途中・0・桁区切りを勝手に変換しない',()=>{
 render(<NumberField aria-label="金額" numericText value="1,000" unit="円" readOnly/>);expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('1,000')
})

it('外の Field が持つ識別子を継ぎ、誤りの欄へ移れる',()=>{
 render(<Field label="帰属期間" htmlFor="days" error="期間を直してください"><NumberField unit="日"/></Field>)
 const input=screen.getByRole('spinbutton',{name:'帰属期間'}) as HTMLInputElement
 expect(input.id).toBe('days');expect(input.getAttribute('aria-invalid')).toBe('true');input.focus();expect(document.activeElement).toBe(input)
})

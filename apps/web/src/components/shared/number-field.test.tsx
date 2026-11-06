// @vitest-environment happy-dom
import React, {createRef} from 'react'
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

it('識別子を省略した数値欄も Field のラベルとつながる',()=>{
 const {container}=render(<Field label="人数"><NumberField value="2" unit="人" readOnly/></Field>)
 const input=screen.getByRole('spinbutton',{name:'人数'}) as HTMLInputElement
 const label=Array.from(container.querySelectorAll('label')).find(node=>node.textContent?.startsWith('人数'))
 expect(input.id).not.toBe('');expect(label?.htmlFor).toBe(input.id)
})

it('3桁区切りは非編集中の表示だけで、値・ref・入力イベントは元の数値を保つ',()=>{
 const ref=createRef<HTMLInputElement>(),change=vi.fn(),blur=vi.fn(),focus=vi.fn()
 const {container}=render(<NumberField ref={ref} aria-label="予算" defaultValue="12345.50" unit="円" onChange={change} onBlur={blur} onFocus={focus}/>)
 const input=screen.getByRole('spinbutton') as HTMLInputElement
 expect(input.value).toBe('12345.50');expect(ref.current).toBe(input)
 expect(container.querySelector('[data-number-display]')?.textContent).toBe('12,345.50')
 expect(input.parentElement?.contains(container.querySelector('[data-number-unit]'))).toBe(true)
 fireEvent.focus(input);expect(container.querySelector('[data-number-display]')).toBeNull();expect(focus).toHaveBeenCalledOnce()
 fireEvent.change(input,{target:{value:'54321'}});expect(change.mock.calls[0][0].target.value).toBe('54321')
 fireEvent.blur(input);expect(blur).toHaveBeenCalledOnce();expect(container.querySelector('[data-number-display]')?.textContent).toBe('54,321')
 fireEvent.change(input,{target:{value:''}});expect(container.querySelector('[data-number-display]')).toBeNull()
})
it('ネイティブのフォームリセットで表示だけが古い値にならない',()=>{
 const {container}=render(<form><NumberField aria-label="予算" defaultValue="12345"/><button type="reset">戻す</button></form>)
 const input=screen.getByRole('spinbutton') as HTMLInputElement
 fireEvent.change(input,{target:{value:'54321'}});expect(container.querySelector('[data-number-display]')?.textContent).toBe('54,321')
 fireEvent.reset(container.querySelector('form')!);expect(container.querySelector('[data-number-display]')?.textContent).toBe('12,345')
})

it('編集でrefを付け直さず、callback refの後始末を実行する',()=>{
 const dispose=vi.fn(),ref=vi.fn(()=>dispose)
 const {unmount}=render(<NumberField ref={ref} aria-label="人数" defaultValue="1000"/>)
 fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'2000'}})
 expect(ref).toHaveBeenCalledOnce();expect(dispose).not.toHaveBeenCalled();unmount();expect(dispose).toHaveBeenCalledOnce()
})

// @vitest-environment happy-dom
import React from 'react'
import {render,screen,cleanup} from '@testing-library/react'
import {afterEach,expect,it} from 'vitest'
import EmptyValue,{emptyValue,displayValue,EMPTY_VALUE_LABELS} from './empty-value'
afterEach(cleanup)
it('空の意味を3語に限定する',()=>{
 expect(EMPTY_VALUE_LABELS).toEqual({unknown:'—',unconfigured:'未設定',none:'なし'})
 render(<><EmptyValue kind="unknown"/><EmptyValue kind="unconfigured"/><EmptyValue kind="none"/></>);expect(screen.getByText('—未設定なし')).toBeTruthy()
})
it('数値の0・falseは空にせず、まだ設定していない値は未設定',()=>{
 expect(displayValue(0)).toBe('0');expect(displayValue(false)).toBe('false');expect(displayValue(null,'unconfigured')).toBe('未設定');expect(emptyValue('none')).toBe('なし')
})

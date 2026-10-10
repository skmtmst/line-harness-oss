// @vitest-environment happy-dom
import React from 'react'
import {render,screen,cleanup,fireEvent} from '@testing-library/react'
import {afterEach,expect,it} from 'vitest'
import {Field,fieldNoteIsLong} from './form-controls'
afterEach(cleanup)
it('短い補足は1行、長い説明は？から読む',()=>{
 const long='予約の受付期間を変えると、これから予約する方に表示される日付が変わります。すでに入った予約は残ります。'
 render(<><Field label="人数" note="1〜23"><input/></Field><Field label="受付期間" note={long}><input/></Field></>)
 expect(screen.getByText('1〜23')).toBeTruthy();expect(screen.queryByText(long)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'受付期間の説明'}));expect(screen.getByText(long)).toBeTruthy()
})
it('改行のある補足も？に集め、誤りは本文に残す',()=>{
 expect(fieldNoteIsLong('1行目\n2行目')).toBe(true)
 render(<Field label="名前" note="長い説明です。長い説明です。長い説明です。長い説明です。長い説明です。" error="名前を入れてください"><input/></Field>);expect(screen.getByRole('alert').textContent).toBe('名前を入れてください')
})

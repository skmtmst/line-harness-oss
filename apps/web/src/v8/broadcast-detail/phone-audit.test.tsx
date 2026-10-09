// @vitest-environment happy-dom
import React from 'react'
import { cleanup,render } from '@testing-library/react'
import {afterEach,expect,it} from 'vitest'
import Phone from './phone'
afterEach(cleanup)
it('WEB113: 1通のテキストでも保存されたボタンをプレビューに出す',()=>{
 const view=render(<Phone accountName="店" time="—" broadcast={{messageType:'text',messageContent:'お知らせ',messageOptions:{buttons:[{label:'申し込む',type:'url',value:'https://example.com'}]}}}/>)
 expect(view.container.textContent).toContain('申し込む')
})

// @vitest-environment happy-dom
import React from 'react'
import {render,screen,cleanup,fireEvent} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {ValueBarChart,LineChart,FunnelChart,chartNumber,chartDate,CHART_COLORS} from './charts'
afterEach(cleanup)
it('棒の軸・吹き出し・色を共通部品が持ち、不明と0を区別する',()=>{
 const {container}=render(<ValueBarChart label="売上" unit="円" items={[{key:'a',label:'2026-10-09',value:12345},{key:'b',label:'2026-10-10',value:null},{key:'c',label:'2026-10-11',value:0}]}/> )
 expect(screen.getByRole('button',{name:'2026-10-09 12,345円'})).toBeTruthy()
 expect(screen.getByRole('button',{name:'2026-10-10 —'})).toBeTruthy()
 expect(screen.getByRole('button',{name:'2026-10-11 0円'})).toBeTruthy()
 expect(container.querySelector('[style*="background"]')?.getAttribute('style')).toContain(CHART_COLORS.primary)
 expect(chartDate('2026-10-09')).toBe('10/9')
 expect(chartNumber(null,'人')).toBe('—')
})
it('漏斗を選ぶと元の識別子を返す',()=>{
 const select=vi.fn();render(<FunnelChart label="配信" onSelect={select} selectedKey="b" items={[{key:'a',label:'開始',value:10},{key:'b',label:'完了',value:3}]}/> )
 fireEvent.click(screen.getByRole('button',{name:'完了 3人'}));expect(select).toHaveBeenCalledWith('b')
 expect(screen.getByRole('button',{name:'完了 3人'}).getAttribute('aria-pressed')).toBe('true')
})
it('線は欠測をつなげず、実際の時刻と値を読み上げる',()=>{
 const {container}=render(<LineChart label="視聴" points={[{x:0,value:100,label:'0:00'},{x:60,value:null,label:'1:00'},{x:120,value:20,label:'2:00'}]} unit="%"/> )
 expect(container.querySelector('path')?.getAttribute('d')?.match(/M/g)).toHaveLength(2)
 expect(screen.getByLabelText('2:00 20%')).toBeTruthy()
})

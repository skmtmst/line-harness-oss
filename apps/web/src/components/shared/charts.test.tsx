// @vitest-environment happy-dom
import React from 'react'
import {render,screen,cleanup,fireEvent} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {ValueBarChart,LineChart,FunnelChart,chartNumber,chartDate,CHART_COLORS} from './charts'
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
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

it('狭い軸は間引き、全日付の棒と読み上げを残し、幅が戻れば軸も増える', async () => {
 let width = 320
 let resized: () => void = () => {}
 vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: 100, width, height: 100, toJSON: () => ({}) }))
 vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback } observe() {} disconnect() {} })
 const items = Array.from({ length: 30 }, (_, i) => ({ key: String(i), label: `2026-09-${String(i + 1).padStart(2, '0')}`, value: i }))
 const { container } = render(<ValueBarChart label="日別" items={items} />)
 expect(screen.getAllByRole('button')).toHaveLength(30)
 expect(screen.getByRole('button', { name: '2026-09-01 0' })).toBeTruthy()
 expect(screen.getByRole('button', { name: '2026-09-30 29' })).toBeTruthy()
 const axes = () => container.querySelectorAll('[data-chart-axis]:not([hidden])')
 const narrow = axes().length
 expect(narrow).toBeLessThanOrEqual(8)
 expect(container.querySelector('[data-axis-edge="first"]')?.hasAttribute('hidden')).toBe(false)
 expect(container.querySelector('[data-axis-edge="last"]')?.hasAttribute('hidden')).toBe(false)
 width = 1200
 const { act } = await import('@testing-library/react')
 act(() => resized())
 expect(axes().length).toBeGreaterThan(narrow)
 expect(screen.getAllByRole('button')).toHaveLength(30)
})

it('符号付きは0基準の上下に描き、欠測と観測0を区別する',()=>{
 render(<ValueBarChart signed label="増減" unit="人" items={[{key:'a',label:'10/1',value:-4},{key:'b',label:'10/2',value:8},{key:'c',label:'10/3',value:null},{key:'d',label:'10/4',value:0}]}/>);
 const negative=screen.getByRole('button',{name:'10/1 -4人'}).querySelector('[style]') as HTMLElement;
 const positive=screen.getByRole('button',{name:'10/2 8人'}).querySelector('[style]') as HTMLElement;
 expect(parseFloat(negative.style.height)).toBeGreaterThan(0);expect(parseFloat(negative.style.bottom)).toBeLessThan(parseFloat(positive.style.bottom));
 expect(screen.getByRole('button',{name:'10/3 —'})).toBeTruthy();expect(screen.getByRole('button',{name:'10/4 0人'})).toBeTruthy();
})

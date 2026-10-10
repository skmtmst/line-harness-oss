import { expect, it } from 'vitest'
import { DIALOG_WIDTHS, DRAWER_WIDTHS, DETAIL_PANEL_WIDTH, dialogWidth, drawerWidth } from './panel-sizes'
it('B-158 決まり8：窓は4段、編集の引き出しは2段、行の詳細は360', () => {
 expect(DIALOG_WIDTHS).toEqual([480,560,720,960]); expect(DRAWER_WIDTHS).toEqual([480,540]); expect(DETAIL_PANEL_WIDTH).toBe(360)
 expect([440,520,600,1060].map(dialogWidth)).toEqual([480,560,720,960])
 expect([360,480,620,780].map(drawerWidth)).toEqual([480,480,540,540])
})

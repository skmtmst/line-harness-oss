// @vitest-environment happy-dom
import {afterEach,expect,test} from 'vitest';
import {CUSTOMER_DESIGNS,DEFAULT_CUSTOMER_LOOK} from '@line-crm/shared';
import {applyCustomerLook,applyCustomerFormTheme} from './customer-look';
afterEach(()=>{document.documentElement.removeAttribute('style');document.getElementById('customer-look-style')?.remove()});
test('配備入口の全ページに5型とカスタムを載せ、フォームの固定色を後から優先する',()=>{
 for(const design of CUSTOMER_DESIGNS){applyCustomerLook({...DEFAULT_CUSTOMER_LOOK,preset:design.id});expect(document.documentElement.style.getPropertyValue('--customer-primary')).toBe(design.main)}
 applyCustomerLook({...DEFAULT_CUSTOMER_LOOK,preset:'custom',primaryColor:'#456789',backgroundColor:'#ffffff',headingFont:'mincho'});
 expect(document.documentElement.style.getPropertyValue('--liff-font-heading')).toContain('Mincho');
 applyCustomerFormTheme({main:'#123d2f',sub:'#fbfaf7',text:'#1a1a1a'});expect(document.documentElement.style.getPropertyValue('--customer-primary')).toBe('#123d2f');
 expect(document.querySelectorAll('#customer-look-style')).toHaveLength(1);
});
test('読めない設定は既定。CSS文字列をスタイルへ混ぜない',()=>{applyCustomerLook({...DEFAULT_CUSTOMER_LOOK,preset:'custom',primaryColor:'red;display:none'});expect(document.documentElement.getAttribute('style')).not.toContain('display:none')});

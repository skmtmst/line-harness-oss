import {expect,test} from 'vitest';
import {CUSTOMER_DESIGNS,DEFAULT_CUSTOMER_LOOK,customerLookError,resolveCustomerFormTheme,customerFormTheme} from './customer-look';
import {FORM_THEME_DEFAULT,formThemeContrastError,emptyLayout,validateFormDefinition} from './form-layout';
test('店の継承・固定型・カスタム・旧色の優先順位が保存後も同じ',()=>{
 const account={...DEFAULT_CUSTOMER_LOOK,preset:'natural' as const};
 const old={...FORM_THEME_DEFAULT,main:'#456789'};
 expect(resolveCustomerFormTheme({theme:old},account).main).toBe('#456789');
 expect(resolveCustomerFormTheme({theme:old,customerDesign:{mode:'account',preset:'line'}},account).main).toBe('#123d2f');
 expect(resolveCustomerFormTheme({theme:old,customerDesign:{mode:'fixed',preset:'modern'}},account).main).toBe('#2b2d31');
 expect(resolveCustomerFormTheme({theme:old,customerDesign:{mode:'fixed',preset:'custom'}},account).main).toBe('#456789');
 for(const design of CUSTOMER_DESIGNS) expect(formThemeContrastError(customerFormTheme({...account,preset:design.id}))).toBeNull();
});
test('任意CSS・未知の型・書体を保存できない',()=>{
 for(const patch of [{primaryColor:'red;display:none'},{backgroundColor:'#abc'},{headingFont:'url(evil)'},{preset:'unknown'}]) expect(customerLookError({...DEFAULT_CUSTOMER_LOOK,...patch})).not.toBeNull();
 const layout=emptyLayout();layout.options.customerDesign={mode:'fixed',preset:'unknown'} as never;expect(validateFormDefinition(layout)).toContain('デザイン');
});

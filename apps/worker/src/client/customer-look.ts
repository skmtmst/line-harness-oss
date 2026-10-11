import {customerPalette,resolveCustomerLook,normalizeFormTheme,formThemeButtonText,type FormTheme} from '@line-crm/shared';
const FONT_STACKS={mincho:'"Shippori Mincho", "Yu Mincho", serif',marugothic:'"Zen Maru Gothic", sans-serif',sans:'"Inter", "Noto Sans JP", sans-serif',default:'inherit'};
/** 配備用の入口で、旧HTML画面もReact画面も同じ店の設定を読む。 */
export function applyCustomerLook(raw: unknown) {
 const look=resolveCustomerLook(raw), palette=customerPalette(look);
 const root=document.documentElement;root.dataset.customerDesign=look.preset;root.dataset.liffTheme=look.preset==='custom'?'line':look.preset;
 installStyle();setColors({main:palette.main,sub:palette.background,text:palette.text},palette.sub);
 root.style.setProperty('--liff-font-heading',FONT_STACKS[palette.font]);
}
export function applyCustomerFormTheme(raw: unknown) {
 const theme=normalizeFormTheme(raw);installStyle();setColors(theme,theme.sub);
 document.documentElement.style.setProperty('--liff-font-heading',theme.fontFamily==='serif'?FONT_STACKS.mincho:FONT_STACKS.sans);
 document.documentElement.style.setProperty('--customer-error',theme.error);
}
function setColors(theme: Pick<FormTheme,'main'|'sub'|'text'>,ground:string) {
 const root=document.documentElement;root.dataset.customerLook='saved';
 for (const [key,value] of Object.entries({'--customer-primary':theme.main,'--customer-background':theme.sub,'--customer-ground':ground,'--customer-text':theme.text,'--customer-on-primary':formThemeButtonText({...normalizeFormTheme(undefined),...theme}),'--color-liff-primary':theme.main,'--color-canvas':theme.sub,'--color-ground':ground,'--color-ink':theme.text})) root.style.setProperty(key,value);
}
function installStyle() {
 if(document.getElementById('customer-look-style'))return;
 const style=document.createElement('style');style.id='customer-look-style';
 style.textContent=`
 html[data-customer-look] :is(.bg-white,.bg-gray-50,.bg-gray-100) { background-color:var(--customer-ground); }
 html[data-customer-look] :is(.text-gray-900,.text-gray-800,.text-gray-700) { color:var(--customer-text); }
 html[data-customer-look] :is(.sb-line-green,.eb-line-green,.af-line-green,.wm-line-green) { color:var(--customer-on-primary); }
 html[data-customer-look] :is(.sb-active,.eb-active,.af-active,.nm-active) :is(h1,h2,h3) { font-family:var(--liff-font-heading); }
 html[data-customer-look] body { background:var(--customer-background); color:var(--customer-text); }
 html[data-customer-look] :is(.form-body,.confirm-card,.booking-calendar,.slots-section,.confirm-section) { background:var(--customer-ground); color:var(--customer-text); }
 html[data-customer-look] :is(h1,h2,.form-title,.booking-title) { font-family:var(--liff-font-heading,inherit); }
 html[data-customer-look] :is(.submit-btn,.btn-primary,.slot-btn.selected,.cal-day.selected) { background:var(--customer-primary); color:var(--customer-on-primary); }
 html[data-customer-look] :is(.form-field input,.form-field textarea,.form-field select,.radio-label,.checkbox-label) { background:var(--customer-ground); color:var(--customer-text); }
 html[data-customer-look] :is(.form-field input,.radio-label input,.checkbox-label input) { accent-color:var(--customer-primary); }
 html[data-customer-look] :is(.radio-label,.checkbox-label):has(input:checked) { border-color:var(--customer-primary); }
 html[data-customer-look] :is(.form-error,.required-mark) { color:var(--customer-error,#e53e3e); }
 `;document.head.appendChild(style);
}

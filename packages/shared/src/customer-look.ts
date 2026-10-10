import {FORM_THEME_DEFAULT, normalizeFormTheme, type FormOptions, type FormTheme, type CustomerDesignPreset} from './form-layout';
export type CustomerHeadingFont = 'default' | 'mincho' | 'marugothic' | 'sans';
export type CustomerLook = {preset: CustomerDesignPreset; primaryColor: string | null; backgroundColor: string | null; headingFont: CustomerHeadingFont};
export const DEFAULT_CUSTOMER_LOOK: CustomerLook = {preset:'line',primaryColor:null,backgroundColor:null,headingFont:'default'};
/** 採用済みLIFF5型の色。予約・フォーム・見本で同じ組を使う。 */
export const CUSTOMER_DESIGNS = [
  {id:'natural',label:'ナチュラル',note:'落ち着いた緑・明朝の見出し',main:'#123d2f',background:'#fbfaf7',sub:'#e7ecea',text:'#1a1a1a',font:'mincho',radius:'round'},
  {id:'modern',label:'モダン',note:'白と黒・すっきり',main:'#2b2d31',background:'#ffffff',sub:'#f5f5f5',text:'#111111',font:'sans',radius:'medium'},
  {id:'gentle',label:'やさしい',note:'あたたかい色・丸い書体',main:'#b5532f',background:'#fff8f3',sub:'#f8eeea',text:'#3b2a22',font:'marugothic',radius:'round'},
  {id:'night',label:'夜（深い紺）',note:'深い紺に金・夜のお店に',main:'#c9a96a',background:'#0f1c33',sub:'#172a47',text:'#f2f5fa',font:'mincho',radius:'round'},
  {id:'line',label:'LINEらしい',note:'LINEの緑・なじみの形',main:'#03873a',background:'#f7f5f0',sub:'#e8f8ee',text:'#1d1d1f',font:'sans',radius:'medium'},
] as const;
export function customerLookError(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'デザインの設定を確認してください';
  const value=raw as Record<string,unknown>;
  if (![...CUSTOMER_DESIGNS.map(item=>item.id),'custom'].includes(value.preset as never)) return 'デザインの型を選んでください';
  for(const key of ['primaryColor','backgroundColor']) if (value[key] != null && (typeof value[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(value[key] as string))) return '色は6桁のHEXで入力してください';
  if (!['default','mincho','marugothic','sans'].includes(value.headingFont as string)) return '見出しの書体を選び直してください';
  return null;
}
export function resolveCustomerLook(raw?: unknown): CustomerLook {
  if (customerLookError(raw)) return {...DEFAULT_CUSTOMER_LOOK};
  const value=raw as CustomerLook;
  return {preset:value.preset,primaryColor:value.primaryColor?.toLowerCase() ?? null,backgroundColor:value.backgroundColor?.toLowerCase() ?? null,headingFont:value.headingFont};
}
export function customerPalette(look: CustomerLook) {
  const preset=CUSTOMER_DESIGNS.find(item=>item.id===look.preset) ?? CUSTOMER_DESIGNS[4];
  return {...preset,main:look.preset==='custom' ? look.primaryColor ?? preset.main : preset.main,
    background:look.preset==='custom' ? look.backgroundColor ?? preset.background : preset.background,
    font:look.preset==='custom' ? look.headingFont : preset.font};
}
export function customerFormTheme(look: CustomerLook): FormTheme {
  const palette=customerPalette(look);
  return {...FORM_THEME_DEFAULT,main:palette.main,sub:palette.background,accent:palette.main,text:palette.text,
    fontFamily:palette.font==='mincho'?'serif':'sans',cornerRadius:palette.radius};
}
/** 明示した継承 > 固定した型 > 旧カスタム > 店の設定。 */
export function resolveCustomerFormTheme(options: FormOptions, accountLook=DEFAULT_CUSTOMER_LOOK): FormTheme {
  const backgroundImageUrl=normalizeFormTheme(options.theme).backgroundImageUrl;
  if (options.customerDesign?.mode === 'account') return {...customerFormTheme(accountLook),backgroundImageUrl};
  if (options.customerDesign?.mode === 'fixed') return options.customerDesign.preset==='custom'
    ? normalizeFormTheme(options.theme) : {...customerFormTheme({...DEFAULT_CUSTOMER_LOOK,preset:options.customerDesign.preset}),backgroundImageUrl};
  return options.theme ? normalizeFormTheme(options.theme) : customerFormTheme(accountLook);
}
export function customerLookPublicSettings(look: CustomerLook) {
  return {liff_theme:look.preset === 'custom'?'line':look.preset,
    shop_primary_color:look.preset==='custom'?look.primaryColor:null,
    shop_background_color:look.preset==='custom'?look.backgroundColor:null,
    shop_heading_font:look.preset==='custom'?look.headingFont:'default'};
}

import { INITIAL_MENUS, initialMenuFormTargets, initialFormKey, type AccountStyle } from '@line-crm/shared';
import type { StarterDefinition, StarterItem } from './style-starter-types.js';

/** 標準・統括の同じ初期セットの中で選べる4面。別の保存先や版管理は持たない。 */
export function initialMenuItems(style: AccountStyle, menuKey = 'menu'): StarterItem[] {
 const forms: StarterItem[] = initialMenuFormTargets(style).map(target => ({
  key:initialFormKey(style,target),kind:'form',formTarget:target,
  name:INITIAL_MENUS[style].buttons.find(button=>button.target===target)!.label,
 }));
 return [...forms,{key:menuKey,kind:'rich_menu',name:'シンプルなメニュー',initialMenu:style,buttons:INITIAL_MENUS[style].buttons.map(button=>({...button}))}];
}
export function withInitialMenu(definition: StarterDefinition, style: AccountStyle): StarterDefinition {
 if(definition.mode==='catalog')return definition;
 const key=definition.items.find(item=>item.kind==='rich_menu')?.key ?? 'menu';
 const generated=initialMenuItems(style,key), keys=new Set(generated.map(item=>item.key));
 return {items:[...definition.items.filter(item=>item.kind!=='rich_menu'&&!keys.has(item.key)),...generated]};
}

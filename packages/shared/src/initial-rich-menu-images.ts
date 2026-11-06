import images from './assets/initial-rich-menu-images.json';
import type { AccountStyle } from './style-api.js';
/** 同じPNGを管理画面の見本とLINEへのアップロードに使う。 */
export function initialMenuImageDataUri(style: AccountStyle) { return `data:image/png;base64,${images[style]}`; }
export function initialMenuPng(style: AccountStyle): Uint8Array { return Uint8Array.from(atob(images[style]), character => character.charCodeAt(0)); }

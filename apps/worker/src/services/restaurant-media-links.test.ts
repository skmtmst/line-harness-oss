import {it,expect} from 'vitest';import {safeRestaurantHttpsUrl,restaurantReservationEmbed} from './restaurant-media-links.js';
it('HTTPSだけを許可し、認証情報入り・壊れたURLを拒む',()=>{for(const url of ['http://example.com','javascript:alert(1)','https://user:pass@example.com','broken'])expect(safeRestaurantHttpsUrl(url)).toBeUndefined();expect(safeRestaurantHttpsUrl(null)).toBeNull();expect(safeRestaurantHttpsUrl('https://example.com')).toBe('https://example.com/');});
it('発行するHTMLは安全なリンクで、予約APIの提供を明示する',()=>{const r=restaurantReservationEmbed('20001234-abCD','token');expect(r.url).toBe('https://liff.line.me/20001234-abCD/restaurant/reserve/token');expect(r.available).toBe(true);expect(r.html).toContain('noopener noreferrer');});

it('予約のtokenをパスの1要素として符号化する',()=>{expect(restaurantReservationEmbed('shop','a/b?c#d').url).toBe('https://liff.line.me/shop/restaurant/reserve/a%2Fb%3Fc%23d');});

import { describe, expect, it } from 'vitest';
import { MediaImpactMatcher } from './media-impact-matcher.js';

describe('media impact matcher', () => {
  it('複数のキーと入れ子の参照を別々に数える', () => {
    const matcher = new MediaImpactMatcher([
      {key:'media/image.png',mediaId:'a',includeLive:true},
      {key:'media/image.png.old',mediaId:'b',includeLive:false},
      {key:'日本語/写真.png',mediaId:'c',includeLive:true},
    ]);
    expect([...matcher.match(JSON.stringify({content:JSON.stringify(['/media/a/content','https://example.test/media/image.png.old','%E6%97%A5%E6%9C%AC%E8%AA%9E%2F%E5%86%99%E7%9C%9F.png'])}))].sort()).toEqual([0,1,2]);
    expect([...matcher.match('b')]).toEqual([]);
    expect([...matcher.match('c')]).toEqual([2]);
  });
});

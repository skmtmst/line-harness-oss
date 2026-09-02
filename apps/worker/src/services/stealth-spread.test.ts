import { describe, expect, it } from 'vitest';
import { stealthChunkSize } from './broadcast.js';

describe('時間をかけて配る', () => {
  it('0分なら全員を1回で送る（従来どおり）', () => {
    expect(stealthChunkSize(5000, 0, 500)).toBe(5000);
  });

  it('分数で割った人数になる', () => {
    // 3000人を10分で配るなら、1分あたり300人。
    // ただしバッチの単位（500）を下回らないようにする。
    expect(stealthChunkSize(3000, 10, 100)).toBe(300);
  });

  it('端数は切り上げる', () => {
    // 切り捨てると、最後に半端が残って予定より長くかかる。
    expect(stealthChunkSize(1001, 10, 1)).toBe(101);
  });

  it('バッチの単位を下回らない', () => {
    // 1回に送れる最小単位より小さくしても意味がなく、
    // かえって往復が増える。
    expect(stealthChunkSize(100, 60, 500)).toBe(500);
  });

  it('0人でも止まらない', () => {
    expect(stealthChunkSize(0, 10, 500)).toBe(500);
  });

  it('負の分数は「一気に送る」として扱う', () => {
    // 壊れた値で永久に進まなくなる方が困る。
    expect(stealthChunkSize(1000, -5, 500)).toBe(1000);
  });

  it('分数が人数より多くても、1回で少なくともバッチ分は進む', () => {
    // 進む量が0になると、いつまでも終わらない。
    expect(stealthChunkSize(10, 720, 500)).toBeGreaterThan(0);
  });
});

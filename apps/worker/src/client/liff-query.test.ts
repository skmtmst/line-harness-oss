import { describe, expect, test } from 'vitest';
import { mergeLiffStateSearch } from './liff-query.js';

describe('mergeLiffStateSearch', () => {
  test('restores rich-menu parameters from liff.state', () => {
    const search = '?liff.state=%3Fpage%3Dnen-member%26liffId%3D2011090925-2paKqzAC%26tab%3Dpets';
    const restored = new URLSearchParams(mergeLiffStateSearch(search));

    expect(restored.get('page')).toBe('nen-member');
    expect(restored.get('liffId')).toBe('2011090925-2paKqzAC');
    expect(restored.get('tab')).toBe('pets');
    expect(restored.get('liff.state')).toBe('?page=nen-member&liffId=2011090925-2paKqzAC&tab=pets');
  });

  test('preserves OAuth callback values and explicit application parameters', () => {
    const search = '?liff.state=%3Fpage%3Dnen-member%26tab%3Dhome%26code%3Duntrusted%26state%3Duntrusted&page=form&code=oauth-code&state=oauth-state';
    const restored = new URLSearchParams(mergeLiffStateSearch(search));

    expect(restored.get('page')).toBe('form');
    expect(restored.get('tab')).toBe('home');
    expect(restored.get('code')).toBe('oauth-code');
    expect(restored.get('state')).toBe('oauth-state');
  });

  test('leaves ordinary URLs unchanged', () => {
    expect(mergeLiffStateSearch('?page=nen-member&tab=orders')).toBe('?page=nen-member&tab=orders');
  });
});

import { describe, expect, test } from 'vitest';
import { mergeLiffStateSearch } from './liff-state.js';

describe('LIFF callback action parameters', () => {
  test.each([
    ['/?page=salon-book&menu_id=menu-1', 'page', 'salon-book', 'menu_id', 'menu-1'],
    ['/?page=visit-stamps&card=card-1', 'page', 'visit-stamps', 'card', 'card-1'],
    ['?page=form&id=form-1', 'page', 'form', 'id', 'form-1'],
    ['?form=form-1', 'form', 'form-1', 'form', 'form-1'],
  ])('restores %s', (state, key, value, selection, selectedId) => {
    const params = new URLSearchParams(mergeLiffStateSearch(`?liff.state=${encodeURIComponent(state)}`));
    expect(params.get(key)).toBe(value);
    expect(params.get(selection)).toBe(selectedId);
    expect(params.get('liff.state')).toBe(state);
  });

  test('explicit destinations and OAuth credentials win', () => {
    const params = new URLSearchParams(mergeLiffStateSearch(`?page=form&id=explicit&code=oauth&state=oauth-state&liff.state=${encodeURIComponent('/?page=visit-stamps&id=wrong&code=wrong&state=wrong&liffRedirectUri=wrong')}`));
    expect(params.get('page')).toBe('form');
    expect(params.get('id')).toBe('explicit');
    expect(params.get('code')).toBe('oauth');
    expect(params.get('state')).toBe('oauth-state');
    expect(params.has('liffRedirectUri')).toBe(false);
  });
});

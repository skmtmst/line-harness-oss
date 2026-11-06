import { describe, expect, test } from 'vitest';
import { mergeLiffStateLocation, mergeLiffStateSearch } from './liff-state.js';

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

test.each(['/booking?waitlist=w', '/booking?seat_waitlist=w&action=decline', '/booking/history'])('案内の道と引数を共通で復元する %s', state => {
  const url = new URL(mergeLiffStateLocation('/', `?liffId=shop&liff.state=${encodeURIComponent(state)}`), 'https://fixture.test');
  expect(url.pathname).toBe(state.split('?')[0]);
  expect(url.searchParams.get('liffId')).toBe('shop');
  for (const [key, value] of new URLSearchParams(state.split('?')[1])) expect(url.searchParams.get(key)).toBe(value);
});
test.each(['https://outside.test/booking?waitlist=w', '//outside.test/booking?waitlist=w', '/unknown?waitlist=w'])('外部URLや未知の道は復元しない %s', state => {
  expect(new URL(mergeLiffStateLocation('/', `?liff.state=${encodeURIComponent(state)}`), 'https://fixture.test').pathname).toBe('/');
});
test('明示した入口とOAuth値は道より優先し、既存のhashを保つ', () => {
  const url = new URL(mergeLiffStateLocation('/', `?page=form&code=oauth&liff.state=${encodeURIComponent('/booking?code=wrong&waitlist=w')}`, '#anchor'), 'https://fixture.test');
  expect(url.pathname).toBe('/'); expect(url.searchParams.get('page')).toBe('form'); expect(url.searchParams.get('code')).toBe('oauth'); expect(url.hash).toBe('#anchor');
});

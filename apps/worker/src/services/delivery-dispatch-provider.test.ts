import { describe, expect, it } from 'vitest';
import {
  DELIVERY_DISPATCH_PROVIDERS,
  DELIVERY_PROVIDERS,
  DELIVERY_PROVIDER_LABELS,
  createDeliveryDispatchRegistry,
  isDeliveryDispatchProviderId,
  isDeliveryProvider,
  selectDeliveryDispatchQuote,
  type DeliveryDispatchProvider,
  type DeliveryDispatchProviderId,
  type DeliveryDispatchQuote,
} from './delivery-dispatch-provider.js';

const NOW = 1_760_000_000;

function quote(
  provider: DeliveryDispatchProviderId,
  feeAmount: number,
  etaMinutes: number,
  expiresInSec = 300,
): DeliveryDispatchQuote {
  return {
    provider,
    feeAmount,
    etaMinutes,
    expiresAtSec: NOW + expiresInSec,
    quoteReference: `${provider}-${feeAmount}-${etaMinutes}`,
  };
}

function stubProvider(id: DeliveryDispatchProviderId): DeliveryDispatchProvider {
  return {
    id,
    quote: async () => ({ ok: true, value: quote(id, 500, 20) }),
    create: async () => ({
      ok: true,
      value: { provider: id, trackingId: `${id}-track`, feeAmount: 500, etaMinutes: 20 },
    }),
    cancel: async () => ({ ok: true, value: null }),
  };
}

describe('配送業者の値ぞろえ', () => {
  it('注文表に入る業者は、委託先2つに「サービスの配達員」と「店舗が自分で配達」を足したもの', () => {
    expect([...DELIVERY_PROVIDERS]).toEqual(['service', 'store', 'uber_direct', 'wolt_drive']);
    expect([...DELIVERY_DISPATCH_PROVIDERS]).toEqual(['uber_direct', 'wolt_drive']);
  });

  it('すべての業者に画面用の名前がある', () => {
    for (const provider of DELIVERY_PROVIDERS) {
      expect(DELIVERY_PROVIDER_LABELS[provider]).toBeTruthy();
    }
  });

  it('知らない値と、委託先ではない値を見分ける', () => {
    expect(isDeliveryProvider('uber_direct')).toBe(true);
    expect(isDeliveryProvider('store')).toBe(true);
    expect(isDeliveryProvider('menu')).toBe(false);
    expect(isDeliveryProvider(null)).toBe(false);
    // 'store' は注文表には入るが、外部へ手配できる業者ではない。
    expect(isDeliveryDispatchProviderId('store')).toBe(false);
    expect(isDeliveryDispatchProviderId('wolt_drive')).toBe(true);
  });
});

describe('業者の束ね方', () => {
  it('登録した順を優先順として返し、IDで引ける', () => {
    const registry = createDeliveryDispatchRegistry([
      stubProvider('wolt_drive'),
      stubProvider('uber_direct'),
    ]);
    expect([...registry.ids]).toEqual(['wolt_drive', 'uber_direct']);
    expect(registry.get('uber_direct')?.id).toBe('uber_direct');
  });

  it('登録していない業者は null を返す（例外にしない）', () => {
    const registry = createDeliveryDispatchRegistry([stubProvider('uber_direct')]);
    expect(registry.get('wolt_drive')).toBeNull();
  });

  it('同じ業者を二重に登録したら作る時点で止める', () => {
    expect(() =>
      createDeliveryDispatchRegistry([stubProvider('uber_direct'), stubProvider('uber_direct')]),
    ).toThrow(/duplicate delivery dispatch provider: uber_direct/);
  });
});

describe('見積りの選び方', () => {
  it('安い方を選ぶ', () => {
    const selected = selectDeliveryDispatchQuote(
      [quote('uber_direct', 800, 20), quote('wolt_drive', 600, 30)],
      { nowSec: NOW },
    );
    expect(selected?.provider).toBe('wolt_drive');
  });

  it('同じ金額なら早い方を選ぶ', () => {
    const selected = selectDeliveryDispatchQuote(
      [quote('uber_direct', 600, 35), quote('wolt_drive', 600, 25)],
      { nowSec: NOW },
    );
    expect(selected?.provider).toBe('wolt_drive');
  });

  it('金額も時間も同じなら優先順の先を選ぶ', () => {
    const quotes = [quote('wolt_drive', 600, 25), quote('uber_direct', 600, 25)];
    expect(selectDeliveryDispatchQuote(quotes, { nowSec: NOW })?.provider).toBe('uber_direct');
    expect(
      selectDeliveryDispatchQuote(quotes, { nowSec: NOW, priority: ['wolt_drive', 'uber_direct'] })
        ?.provider,
    ).toBe('wolt_drive');
  });

  it('優先順に載っていない業者は最後に回す', () => {
    const selected = selectDeliveryDispatchQuote(
      [quote('wolt_drive', 600, 25), quote('uber_direct', 600, 25)],
      { nowSec: NOW, priority: ['wolt_drive'] },
    );
    expect(selected?.provider).toBe('wolt_drive');
  });

  it('期限が切れた見積りは安くても使わない', () => {
    const selected = selectDeliveryDispatchQuote(
      [quote('uber_direct', 300, 15, -1), quote('wolt_drive', 900, 40)],
      { nowSec: NOW },
    );
    expect(selected?.provider).toBe('wolt_drive');
  });

  it('期限ちょうどの見積りは使わない（境界を含めない）', () => {
    expect(selectDeliveryDispatchQuote([quote('uber_direct', 300, 15, 0)], { nowSec: NOW })).toBeNull();
    expect(selectDeliveryDispatchQuote([quote('uber_direct', 300, 15, 1)], { nowSec: NOW })).not.toBeNull();
  });

  it('使える見積りが無ければ null（呼び出し側が返金や案内へ進める）', () => {
    expect(selectDeliveryDispatchQuote([], { nowSec: NOW })).toBeNull();
    expect(selectDeliveryDispatchQuote([quote('uber_direct', 300, 15, -60)], { nowSec: NOW })).toBeNull();
  });
});

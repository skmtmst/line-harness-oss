import { expect } from 'vitest';

export async function checkRestaurantMenuPrice({ seedRestaurantFixture, request, requestWithMethod }: {
  seedRestaurantFixture: () => void;
  request: (path: string, body?: unknown) => Response | Promise<Response>;
  requestWithMethod: (path: string, method: string, body?: unknown) => Response | Promise<Response>;
}): Promise<void> {
    seedRestaurantFixture();
    const make = (price: number) => request('/api/restaurant-test/menu?account_id=account-1', { storeId: 'store-ginza', kind: 'course', name: '上限試験', price, status: 'draft' });
    const tooHighCreate = await make(1000001);
    expect(tooHighCreate.status).toBe(400);
    expect((await tooHighCreate.json() as any).error).toContain('1,000,000');
    expect((await make(1000000)).status).toBe(201);
    const tooHighUpdate = await requestWithMethod('/api/restaurant-test/menus/menu-ginza?account_id=account-1', 'PATCH', { price: 1000001 });
    expect(tooHighUpdate.status).toBe(400);
    expect((await tooHighUpdate.json() as any).error).toContain('1,000,000');
    expect((await requestWithMethod('/api/restaurant-test/menus/menu-ginza?account_id=account-1', 'PATCH', { price: 1000000 })).status).toBe(200);
}

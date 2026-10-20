// Runtime responses stay unknown until fixture-api-types compiles their actual JSON against the API.
export function paymentGet(pathname: string, query: URLSearchParams, options?: { restaurantTables?: { id: string }[] }): unknown
export function paymentWrite(method: string, pathname: string, body: Record<string, unknown>): unknown

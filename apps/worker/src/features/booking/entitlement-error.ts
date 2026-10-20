
export class EntitlementError extends Error {
  constructor(public code: string, public status: 400 | 404 | 409) { super(code); }
}

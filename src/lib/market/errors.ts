export class MarketError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}

export function marketError(error: unknown) {
  return error instanceof MarketError
    ? { error: error.message, status: error.status }
    : { error: "Trading data is temporarily unavailable. Please try again.", status: 503 };
}

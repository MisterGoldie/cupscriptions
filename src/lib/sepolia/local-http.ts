export function localRequest(request: Request) {
  if (process.env.NODE_ENV !== "development") return false;
  try {
    const host = request.headers.get("host") ?? new URL(request.url).host;
    const origin = new URL(`http://${host}`);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) return false;
    const caller = request.headers.get("origin");
    return (!caller || caller === origin.origin) && request.headers.get("sec-fetch-site") !== "cross-site";
  } catch { return false; }
}

export function localJson(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

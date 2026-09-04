export const SUPPLY = 5000;

/** Compressed collection CID (pinned on Pinata; served via public gateways). */
export const IPFS_CID =
  "QmcL3Yswr6dDuQWnA5nmbqoB9ZSTQ2r34pLKskfLiwftPi";

/** Prefer public gateways — Pinata's free dedicated gateway is over limit. */
export const GATEWAYS = [
  `https://ipfs.io/ipfs/${IPFS_CID}`,
  `https://dweb.link/ipfs/${IPFS_CID}`,
  `https://cloudflare-ipfs.com/ipfs/${IPFS_CID}`,
  `https://gateway.pinata.cloud/ipfs/${IPFS_CID}`,
] as const;

export const GATEWAY_BASE = GATEWAYS[0];

export function cupImageUrl(id: number, gatewayIndex = 0): string {
  const base = GATEWAYS[Math.min(gatewayIndex, GATEWAYS.length - 1)];
  return `${base}/Cupscription_${id}.jpg`;
}

export function clampCupId(id: number): number | null {
  if (!Number.isInteger(id) || id < 1 || id > SUPPLY) return null;
  return id;
}

export function pageCupIds(page: number, perPage: number): number[] {
  const start = (page - 1) * perPage + 1;
  const end = Math.min(start + perPage - 1, SUPPLY);
  if (start > SUPPLY) return [];
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function totalPages(perPage: number): number {
  return Math.ceil(SUPPLY / perPage);
}

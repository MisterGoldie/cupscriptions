export const SUPPLY = 5000;

/** Compressed collection pinned on Pinata (public gateway). */
export const IPFS_CID =
  "QmcL3Yswr6dDuQWnA5nmbqoB9ZSTQ2r34pLKskfLiwftPi";

export const GATEWAY_BASE = `https://gateway.pinata.cloud/ipfs/${IPFS_CID}`;

export function cupImageUrl(id: number): string {
  return `${GATEWAY_BASE}/Cupscription_${id}.jpg`;
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

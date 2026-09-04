import { CUP_TOKEN, EXPLORER_API } from "@/lib/wagmi";

export type OwnedCup = {
  /** Display id 1–5000 (Cupscription #N) */
  id: number;
  /** On-chain ERC-721 token id (0-indexed) */
  tokenId: number;
  name: string;
  ethscriptionId?: string;
};

type ExplorerInstance = {
  id: string;
  metadata?: {
    name?: string;
    ethscription_id?: string;
  };
};

type ExplorerPage = {
  items: ExplorerInstance[];
  next_page_params: { unique_token?: string } | null;
};

function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export async function fetchOwnedCups(address: string): Promise<OwnedCup[]> {
  if (!isAddress(address)) {
    throw new Error("Invalid wallet address");
  }

  const owned: OwnedCup[] = [];
  let uniqueToken: string | undefined;

  for (let page = 0; page < 50; page += 1) {
    const url = new URL(
      `${EXPLORER_API}/tokens/${CUP_TOKEN}/instances`,
    );
    url.searchParams.set("holder_address_hash", address);
    if (uniqueToken) url.searchParams.set("unique_token", uniqueToken);

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      throw new Error(`Explorer returned ${res.status}`);
    }

    const data = (await res.json()) as ExplorerPage;
    for (const item of data.items ?? []) {
      const tokenId = Number(item.id);
      if (!Number.isInteger(tokenId) || tokenId < 0) continue;
      owned.push({
        tokenId,
        id: tokenId + 1,
        name: item.metadata?.name ?? `Cupscription #${tokenId + 1}`,
        ethscriptionId: item.metadata?.ethscription_id,
      });
    }

    uniqueToken = data.next_page_params?.unique_token;
    if (!uniqueToken) break;
  }

  return owned.sort((a, b) => a.id - b.id);
}

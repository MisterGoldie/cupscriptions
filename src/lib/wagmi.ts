import { http, createConfig, injected } from "wagmi";
import { mainnet } from "wagmi/chains";

export const CUP_TOKEN =
  "0x4fC973473b9304c18952d5ce565e160769928227" as const;

export const EXPLORER_API =
  "https://explorer.ethscriptions.com/api/v2";

export const config = createConfig({
  chains: [mainnet],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [mainnet.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}

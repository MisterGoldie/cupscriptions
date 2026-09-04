"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletButton() {
  const { address, isConnected, status } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  if (status === "connecting" || status === "reconnecting") {
    return (
      <span className="border border-ash px-3 py-2 text-sm text-mute">
        Connecting…
      </span>
    );
  }

  if (isConnected && address) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="border border-volt/40 bg-volt/10 px-3 py-2 text-sm font-medium text-volt transition hover:bg-volt/20"
        >
          {shortAddress(address)}
        </button>
        {open ? (
          <div className="absolute right-0 mt-2 min-w-44 border border-ash bg-ink-soft py-1 shadow-xl">
            <Link
              href="/my-cups"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-bone transition hover:bg-ash hover:text-volt"
            >
              My Cups
            </Link>
            <button
              type="button"
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
              className="block w-full px-4 py-2 text-left text-sm text-mute transition hover:bg-ash hover:text-bone"
            >
              Disconnect
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  const connector = connectors[0];

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        disabled={!connector || isPending}
        onClick={() => {
          if (!connector) return;
          connect({ connector });
        }}
        className="bg-volt px-3 py-2 text-sm font-semibold text-ink transition hover:bg-volt-hot disabled:opacity-50"
      >
        {isPending ? "Check wallet…" : "Connect"}
      </button>
      {error ? (
        <p className="absolute right-0 top-full mt-2 w-56 text-right text-xs text-ember">
          {error.message.includes("Connector not found") ||
          error.message.includes("Provider not found")
            ? "Install MetaMask or another browser wallet."
            : error.message}
        </p>
      ) : null}
    </div>
  );
}

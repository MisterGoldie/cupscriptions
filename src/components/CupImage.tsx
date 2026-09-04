"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { IPFS_CID } from "@/lib/cups";

const GATEWAYS = [
  `https://gateway.pinata.cloud/ipfs/${IPFS_CID}`,
  `https://ipfs.io/ipfs/${IPFS_CID}`,
  `https://dweb.link/ipfs/${IPFS_CID}`,
];

type CupImageProps = {
  id: number;
  alt?: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  fill?: boolean;
  width?: number;
  height?: number;
};

export function CupImage({
  id,
  alt,
  className,
  sizes = "(max-width: 768px) 50vw, 25vw",
  priority = false,
  fill = false,
  width,
  height,
}: CupImageProps) {
  const [gatewayIndex, setGatewayIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  const src = useMemo(
    () => `${GATEWAYS[Math.min(gatewayIndex, GATEWAYS.length - 1)]}/Cupscription_${id}.jpg`,
    [gatewayIndex, id],
  );

  function handleError() {
    if (gatewayIndex < GATEWAYS.length - 1) {
      setGatewayIndex((i) => i + 1);
      return;
    }
    setFailed(true);
  }

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-ash text-mute ${className ?? ""}`}
        aria-label={alt ?? `Cupscription ${id}`}
      >
        <span className="text-xs tracking-wide">#{id}</span>
      </div>
    );
  }

  if (fill) {
    return (
      <Image
        key={src}
        src={src}
        alt={alt ?? `Cupscription #${id}`}
        fill
        sizes={sizes}
        priority={priority}
        unoptimized
        className={className}
        onError={handleError}
      />
    );
  }

  return (
    <Image
      key={src}
      src={src}
      alt={alt ?? `Cupscription #${id}`}
      width={width ?? 600}
      height={height ?? 600}
      sizes={sizes}
      priority={priority}
      unoptimized
      className={className}
      onError={handleError}
    />
  );
}

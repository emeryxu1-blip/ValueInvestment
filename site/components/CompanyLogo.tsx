"use client";

import { useState, type CSSProperties } from "react";
import { companyLogoUrl } from "@/lib/company-logo";

function logoHue(symbol: string) {
  return [...symbol].reduce(
    (sum, character) => sum + character.charCodeAt(0),
    0,
  ) % 360;
}

export function CompanyLogo({
  symbol,
  className,
  loading = "lazy",
}: {
  symbol: string;
  className: string;
  loading?: "eager" | "lazy";
}) {
  const url = companyLogoUrl(symbol);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = url != null && failedUrl !== url;
  const style = { "--logo-hue": logoHue(symbol) } as CSSProperties;

  return (
    <span className={className} style={style} aria-hidden="true">
      {symbol.slice(0, 2).toUpperCase()}
      {showImage ? (
        // A native image keeps this static CDN asset independent of Next's image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          width={64}
          height={64}
          loading={loading}
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(url)}
        />
      ) : null}
    </span>
  );
}

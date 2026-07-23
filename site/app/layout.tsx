import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("http://localhost:3001"),
  title: {
    default: "Find Value Opportunities · Value Lens",
    template: "%s · Value Lens",
  },
  description:
    "Find value opportunities with a margin of safety, then test owner earnings, financial resilience, market expectations, and business quality.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "Value Lens — Find value opportunities",
    description:
      "Find what price may be missing, then test the opportunity with a disciplined value-investing method.",
    type: "website",
    images: [
      {
        url: "/og-value-lens.png",
        width: 1200,
        height: 630,
        alt: "Value Lens — find what price may be missing",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Value Lens — Find value opportunities",
    description:
      "Screen for a margin of safety, then test owner earnings, market expectations, and business quality.",
    images: ["/og-value-lens.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}

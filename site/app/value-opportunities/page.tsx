import type { Metadata } from "next";
import { ScreenerClient } from "@/components/screener/ScreenerClient";
import "../stock-screener/new/screener.css";

export const metadata: Metadata = {
  title: "Value opportunities",
  description:
    "Find companies where price, cash generation, business quality, and market expectations create a value-investing opportunity.",
  alternates: {
    canonical: "/value-opportunities",
  },
};

export default function ValueOpportunitiesPage() {
  return <ScreenerClient />;
}

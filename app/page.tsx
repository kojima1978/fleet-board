import type { Metadata } from "next";
import { FleetDashboard } from "@/components/fleet-dashboard";

// レイアウトの題名の型は同じ階層のこのページには効かないので、題名をそのまま書く。
export const metadata: Metadata = { title: { absolute: "駐車場｜FleetFlow" } };

export default function Home() {
  return <FleetDashboard view="parking" />;
}

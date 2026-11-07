import type { Metadata } from "next";
import { FleetDashboard } from "@/components/fleet-dashboard";

export const metadata: Metadata = { title: "タイムライン" };

export default function TimelinePage() {
  return <FleetDashboard view="timeline" />;
}

import type { Metadata } from "next";
import { FleetDashboard } from "@/components/fleet-dashboard";

export const metadata: Metadata = { title: "駐車区画" };

export default function SpotSettingsPage() {
  return <FleetDashboard view="settingsSpots" />;
}

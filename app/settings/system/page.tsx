import type { Metadata } from "next";
import { FleetDashboard } from "@/components/fleet-dashboard";

export const metadata: Metadata = { title: "システム" };

export default function SystemSettingsPage() {
  return <FleetDashboard view="settingsSystem" />;
}

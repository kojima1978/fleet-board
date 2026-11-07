import type { Metadata } from "next";
import { FleetDashboard } from "@/components/fleet-dashboard";

export const metadata: Metadata = { title: "データ保存・復元" };

export default function DataSettingsPage() {
  return <FleetDashboard view="settingsData" />;
}

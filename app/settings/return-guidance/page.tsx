import type { Metadata } from "next";
import { FleetDashboard } from "@/components/fleet-dashboard";

export const metadata: Metadata = { title: "案内設定" };

export default function ReturnGuidanceSettingsPage() {
  return <FleetDashboard view="settingsReturnGuidance" />;
}

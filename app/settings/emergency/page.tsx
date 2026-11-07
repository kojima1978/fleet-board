import type { Metadata } from "next";
import { FleetDashboard } from "@/components/fleet-dashboard";

export const metadata: Metadata = { title: "緊急時" };

export default function EmergencySettingsPage() {
  return <FleetDashboard view="settingsEmergency" />;
}

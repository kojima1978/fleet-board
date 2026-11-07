import type { Metadata } from "next";
import { FleetDashboard } from "@/components/fleet-dashboard";

export const metadata: Metadata = { title: "車両登録" };

export default function VehicleSettingsPage() {
  return <FleetDashboard view="settingsVehicles" />;
}

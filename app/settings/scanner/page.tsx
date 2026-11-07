import type { Metadata } from "next";
import { FleetDashboard } from "@/components/fleet-dashboard";

export const metadata: Metadata = { title: "NFC・QR" };

export default function ScannerSettingsPage() {
  return <FleetDashboard view="settingsScanner" />;
}

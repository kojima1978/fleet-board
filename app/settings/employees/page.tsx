import type { Metadata } from "next";
import { FleetDashboard } from "@/components/fleet-dashboard";

export const metadata: Metadata = { title: "社員登録" };

export default function EmployeeSettingsPage() {
  return <FleetDashboard view="settingsEmployees" />;
}

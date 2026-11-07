import type { Metadata } from "next";
import { FleetDashboard } from "@/components/fleet-dashboard";

export const metadata: Metadata = { title: "部署" };

export default function DepartmentSettingsPage() {
  return <FleetDashboard view="settingsDepartments" />;
}

import { FleetDashboard } from "@/components/fleet-dashboard";
import { AdminGate } from "@/components/admin-gate";

export default function EmployeeSettingsPage() {
  return <AdminGate><FleetDashboard view="settingsEmployees" /></AdminGate>;
}

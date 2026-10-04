import { FleetDashboard } from "@/components/fleet-dashboard";
import { AdminGate } from "@/components/admin-gate";

export default function VehicleSettingsPage() {
  return <AdminGate><FleetDashboard view="settingsVehicles" /></AdminGate>;
}

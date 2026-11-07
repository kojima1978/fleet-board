import type { Metadata } from "next";
import { OperationsDashboard } from "@/components/operations-dashboard";

export const metadata: Metadata = { title: "履歴" };

export default function OperationsPage() {
  return <OperationsDashboard />;
}

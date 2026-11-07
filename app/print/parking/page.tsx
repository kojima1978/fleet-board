import type { Metadata } from "next";
import { PrintDashboard } from "@/components/print-dashboard";

export const metadata: Metadata = { title: "駐車場の印刷" };

export default function ParkingPrintPage() {
  return <PrintDashboard mode="parking" />;
}

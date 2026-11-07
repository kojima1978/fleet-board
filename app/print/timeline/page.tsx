import type { Metadata } from "next";
import { PrintDashboard } from "@/components/print-dashboard";

export const metadata: Metadata = { title: "タイムラインの印刷" };

export default function TimelinePrintPage() {
  return <PrintDashboard mode="timeline" />;
}

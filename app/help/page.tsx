import type { Metadata } from "next";
import { HelpGuide } from "@/components/help-guide";

export const metadata: Metadata = { title: "使い方" };

export default function HelpPage() {
  return <HelpGuide />;
}

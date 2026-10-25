import type { NfcResolution } from "@/lib/resolve-nfc";

export async function resolveQrCode(value: string): Promise<NfcResolution | null> {
  const response = await fetch("/api/qr/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }) });
  if (response.status === 404) return null;
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(result?.message ?? "QRコードを確認できませんでした");
  }
  return response.json();
}

export type NfcResolution = { kind: "employee" | "vehicle"; id: string };

export async function resolveNfcUid(uid: string): Promise<NfcResolution | null> {
  const response = await fetch("/api/nfc/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("NFCタグを確認できませんでした");
  return response.json() as Promise<NfcResolution>;
}

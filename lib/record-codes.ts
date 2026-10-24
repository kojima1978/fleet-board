// 社員番号・車両番号は英字1文字と数字3桁に固定する。桁がそろうため、文字列の昇順がそのまま番号順になる。
export const RECORD_CODE_PATTERN = /^[A-Z]\d{3}$/;
export const RECORD_CODE_LENGTH = 4;
export const RECORD_CODE_LABELS = { employee: "社員番号", vehicle: "車両番号" } as const;
export const RECORD_CODE_EXAMPLES = { employee: "E001", vehicle: "C001" } as const;
type RecordCodeKind = keyof typeof RECORD_CODE_LABELS;

// 全角や小文字で入力されても、半角の大文字へそろえる。
export const normalizeRecordCode = (value: string) => value.normalize("NFKC").trim().toUpperCase();
export const isRecordCode = (value: string) => RECORD_CODE_PATTERN.test(value);
// 入力欄用：先頭の英字と続く数字3桁だけを残し、それ以外の文字は受け付けない。
export function sanitizeRecordCodeInput(value: string) {
  const [first = "", ...rest] = normalizeRecordCode(value).replace(/\s/g, "");
  if (!/[A-Z]/.test(first)) return "";
  return first + rest.filter((char) => /\d/.test(char)).join("").slice(0, RECORD_CODE_LENGTH - 1);
}
export const recordCodeMessage = (kind: RecordCodeKind) => `${RECORD_CODE_LABELS[kind]}は英字1文字と数字3桁で入力してください（例：${RECORD_CODE_EXAMPLES[kind]}）`;

// 以前の自由形式の番号（C01、e7、ｃ０１など）を、すべて英字1文字＋3桁へ置き換える。
// 形式どおりの番号はそのまま残し、変換後の番号が重なる場合や変換できない番号は、
// 同じ英字（英字がなければ社員E・車両C）の空いている最小の番号にする。3桁へ埋めるだけで済む番号を先に決める。
// DBの移行（20261027100000_fix_record_code_format）と同じ規則にする。
export function upgradeLegacyCodes<T extends { code: string }>(items: T[], kind: RecordCodeKind): T[] {
  const taken = new Set(items.filter((item) => isRecordCode(item.code)).map((item) => item.code));
  const replaced = new Map<T, string>();
  const legacy = items.filter((item) => !isRecordCode(item.code)).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const assign = (item: T, code: string) => { taken.add(code); replaced.set(item, code); };
  for (const item of legacy) {
    const match = /^([A-Z])(\d{1,3})$/.exec(normalizeRecordCode(item.code));
    const code = match ? `${match[1]}${match[2].padStart(3, "0")}` : "";
    if (code && !taken.has(code)) assign(item, code);
  }
  for (const item of legacy) {
    if (replaced.has(item)) continue;
    const letter = /[A-Z]/.exec(normalizeRecordCode(item.code))?.[0] ?? RECORD_CODE_EXAMPLES[kind][0];
    const code = Array.from({ length: 999 }, (_, index) => `${letter}${String(index + 1).padStart(3, "0")}`).find((next) => !taken.has(next));
    if (!code) throw new Error(`${RECORD_CODE_LABELS[kind]}の${letter}に空いている番号がありません`);
    assign(item, code);
  }
  return items.map((item) => (replaced.has(item) ? { ...item, code: replaced.get(item)! } : item));
}

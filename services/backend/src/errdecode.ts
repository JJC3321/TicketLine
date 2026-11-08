// Decodes program errors into IDL error names.
// Handles: verbose Anchor logs "Error Code: <Name>" and web3.js preflight
// errors "custom program error: 0x177N" (numeric → IDL error map).
import { idl } from "@ticketline/sdk";

const codeToName = new Map<number, string>();
for (const e of (idl as unknown as { errors?: { code: number; name: string }[] }).errors ?? []) {
  codeToName.set(e.code, e.name);
}

export function anchorErrorName(e: unknown): string | null {
  const s = String((e as { message?: string })?.message ?? e);
  const logMsgs = (e as { logs?: string[] })?.logs?.join("\n") ?? "";
  const hay = `${s}\n${logMsgs}`;
  const named = hay.match(/Error Code: (\w+)/);
  if (named) return named[1];
  const hex = hay.match(/custom program error: (0x[0-9a-f]+)/i);
  if (hex) {
    const code = parseInt(hex[1], 16);
    return codeToName.get(code) ?? `custom:${code}`;
  }
  // some paths surface the plain name
  for (const name of codeToName.values()) if (s.includes(name)) return name;
  return null;
}

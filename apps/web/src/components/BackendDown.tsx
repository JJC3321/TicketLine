"use client";
import { API } from "@/lib/api";
export function BackendDown() {
  return (
    <div className="rounded-lg border border-red-800 bg-red-950/60 p-4 text-red-200 text-sm">
      Backend unreachable at <code>{API}</code> — start it with <code>pnpm demo:fresh</code>. Retrying automatically…
    </div>
  );
}

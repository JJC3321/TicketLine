"use client";
import { useEffect, useState } from "react";
import { API, type Ev } from "./api";
export function useEvents(): Ev[] {
  const [evs, setEvs] = useState<Ev[]>([]);
  useEffect(() => {
    const es = new EventSource(`${API}/events`);
    const key = (ev: Ev) =>
      `${ev.kind}:${ev.name}:${ev.signature ?? ""}:${(ev.data?.epoch as string) ?? ev.seq}`;
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data) as Ev;
      setEvs((p) =>
        p.some((x) => x.seq === ev.seq || (ev.signature && key(x) === key(ev))) ? p : [ev, ...p].slice(0, 100),
      );
    };
    return () => es.close();
  }, []);
  return evs;
}

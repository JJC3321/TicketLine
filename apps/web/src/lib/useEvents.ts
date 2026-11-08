"use client";
import { useEffect, useState } from "react";
import { API, type Ev } from "./api";
export function useEvents(): Ev[] {
  const [evs, setEvs] = useState<Ev[]>([]);
  useEffect(() => {
    const es = new EventSource(`${API}/events`);
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data) as Ev;
      setEvs((p) => (p.some((x) => x.seq === ev.seq) ? p : [ev, ...p].slice(0, 100)));
    };
    return () => es.close();
  }, []);
  return evs;
}

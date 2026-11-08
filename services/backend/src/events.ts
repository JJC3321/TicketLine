import { EventEmitter } from "node:events";

export interface DemoEvent {
  seq: number;
  ts: number;
  kind: "program" | "keeper";
  name: string;
  simulated?: boolean;
  signature?: string;
  data: Record<string, unknown>;
}

class EventBus extends EventEmitter {
  private seq = 0;
  readonly ring: DemoEvent[] = [];
  emit0(e: Omit<DemoEvent, "seq" | "ts">) {
    if (
      e.signature &&
      this.ring.some((x) => x.kind === e.kind && x.name === e.name && x.signature === e.signature)
    )
      return;
    const ev: DemoEvent = { ...e, seq: ++this.seq, ts: Date.now() };
    this.ring.push(ev);
    if (this.ring.length > 200) this.ring.shift();
    this.emit("event", ev);
  }
  programEvent(name: string, signature: string | undefined, data: Record<string, unknown>, simulated?: boolean) {
    this.emit0({ kind: "program", name, signature, data, simulated });
  }
  keeper(name: string, data: Record<string, unknown>, simulated?: boolean, signature?: string) {
    this.emit0({ kind: "keeper", name, data, simulated, signature });
  }
}
export const bus = new EventBus();

// Requests over a MessagePort with ids that their answers echo (the IO worker, src/shared/io-protocol.ts).
// A port that closes, or a worker that never answers, leaves the promise pending: the shell does not depend on
// an answer for anything that decides state.

/** `Omit` over each member of a union. */
export type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

export class PortRpc<Req extends { id: number }, Rep extends { id: number }> {
  private readonly port: MessagePort;
  private next = 1;
  private readonly waiting = new Map<number, (r: Rep) => void>();

  constructor(port: MessagePort, onOther?: (m: unknown) => void) {
    this.port = port;
    port.onmessage = (e: MessageEvent) => {
      const m = e.data as Rep;
      const f = typeof m?.id === 'number' ? this.waiting.get(m.id) : undefined;
      if (f) {
        this.waiting.delete(m.id);
        f(m);
      } else onOther?.(e.data);
    };
  }

  request(req: WithoutId<Req>, transfer: Transferable[] = []): Promise<Rep> {
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.port.postMessage({ ...req, id }, transfer);
    });
  }

  close(): void {
    this.port.onmessage = null;
    this.port.close();
    this.waiting.clear();
  }
}

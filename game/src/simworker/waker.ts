// Wakes for the sim shell's clock (10 §3.3): `setTimeout` when the next tick is more than 4 ms away, otherwise a
// message posted to itself, which avoids the 4 ms timer clamp. The shell passes one wake function and cancels
// its pending wake before setting another, so a cancelled self-post is skipped when it arrives; nothing is
// allocated per wake.

const SOON = 'soon' as const;

export function selfPostWaker(): {
  wake(ms: number, f: () => void): unknown;
  cancel(handle: unknown): void;
  /** Closes the self-post channel (an in-process shell that ends). */
  close(): void;
} {
  const channel = new MessageChannel();
  let fn: (() => void) | null = null;
  let skip = 0;
  channel.port1.onmessage = () => {
    if (skip > 0) {
      skip -= 1;
      return;
    }
    fn?.();
  };
  return {
    wake(ms, f) {
      if (ms > 4) return setTimeout(f, ms);
      fn = f;
      channel.port2.postMessage(null);
      return SOON;
    },
    cancel(handle) {
      if (handle === SOON) skip += 1;
      else if (handle !== null && handle !== undefined) clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    close() {
      fn = null;
      channel.port1.onmessage = null;
      channel.port1.close();
      channel.port2.close();
    },
  };
}

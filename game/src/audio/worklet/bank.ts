// The voice-bank AudioWorklet processor (10 §9.4): a thin shell around BankCore. Loaded with
// `audioWorklet.addModule()` from a URL the app layer imports as `bank.ts?worker&url`.
import { BankCore } from './bank-core.ts';
import type { ToBank } from './protocol.ts';
import { scope } from './scope.ts';

export const BANK_PROCESSOR = 'paperwork-bank';

class BankProcessor extends scope.AudioWorkletProcessor {
  private readonly core: BankCore;
  /** Set by the `crash` test hook: process() throws, so the page's failure path can be tested. */
  private crashed = false;

  constructor(options: AudioWorkletNodeOptions) {
    super(options);
    const o = (options.processorOptions ?? {}) as { taps?: number };
    this.core = new BankCore({ sampleRate: scope.sampleRate, taps: o.taps ?? 0 });
    this.port.onmessage = (e: MessageEvent<ToBank>) => {
      if (e.data.t === 'crash') this.crashed = true;
      const reply = this.core.onMessage(e.data);
      if (reply) this.port.postMessage(reply);
      // working loops that ended unasked go back with the next message (never from process())
      const ended = this.core.takeEnded();
      if (ended) this.port.postMessage(ended);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.crashed) throw new Error('the voice bank was told to fail (a test)');
    this.core.process(outputs, scope.currentFrame);
    return true;
  }
}

scope.registerProcessor(BANK_PROCESSOR, BankProcessor);

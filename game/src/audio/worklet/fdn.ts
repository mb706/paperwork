// The FDN reverb AudioWorklet processor (10 §9.4): one node per era slot, a thin shell around FdnCore.
import { FdnCore } from './fdn-core.ts';
import type { FdnConfig, ToFdn } from './protocol.ts';
import { scope } from './scope.ts';

export const FDN_PROCESSOR = 'paperwork-fdn';

class FdnProcessor extends scope.AudioWorkletProcessor {
  private readonly core: FdnCore;

  constructor(options: AudioWorkletNodeOptions) {
    super(options);
    const cfg = (options.processorOptions as { config?: FdnConfig } | undefined)?.config;
    this.core = new FdnCore(scope.sampleRate, cfg);
    this.port.onmessage = (e: MessageEvent<ToFdn>) => {
      if (e.data.t === 'config') this.core.configure(e.data.config);
      else this.core.clear();
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length < 2) return true;
    const oL = out[0] as Float32Array;
    const oR = out[1] as Float32Array;
    const inp = inputs[0];
    const inL = inp?.[0];
    const inR = inp?.[1] ?? inL;
    this.core.process(inL, inR, oL, oR, oL.length);
    return true;
  }
}

scope.registerProcessor(FDN_PROCESSOR, FdnProcessor);

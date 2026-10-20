// The AudioWorkletGlobalScope, typed by hand: TypeScript 7 ships no `audioworklet` lib, and the audio
// layer's tsconfig is the DOM one. The processors reach the scope only through this object.
export interface ProcessorBase {
  readonly port: MessagePort;
}

export interface WorkletScope {
  readonly sampleRate: number;
  readonly currentFrame: number;
  readonly currentTime: number;
  readonly AudioWorkletProcessor: new (options?: AudioWorkletNodeOptions) => ProcessorBase;
  registerProcessor(name: string, ctor: new (options: AudioWorkletNodeOptions) => ProcessorBase): void;
}

export const scope = globalThis as unknown as WorkletScope;

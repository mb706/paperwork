import { step } from './sim';
self.onmessage = (e: MessageEvent<number>) => { const st = new Int32Array(1000); (self as unknown as Worker).postMessage(step(st, e.data)); };

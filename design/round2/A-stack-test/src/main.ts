const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
w.onmessage = (e) => { document.title = 'sum=' + e.data; };
w.postMessage(10);

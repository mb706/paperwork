// Userspace TCP impairment proxy (no root, so no tc/netem). Models what a WebSocket over TCP sees:
// one-way delay, jitter, loss as head-of-line stalls (TCP keeps order, so a lost segment holds back
// everything behind it until its retransmission), a bandwidth cap, abrupt drops and silent black-holes.
// Usage: node netem.mjs --listen 47101 --target 47100 [--delay-ms 20] [--jitter-ms 5] [--stall-p 0.01]
//        [--stall-ms 200] [--down-kbps 0] [--up-kbps 0] [--drop-at-ms 30000,50000] [--hole-at-ms 40000 --hole-ms 3000]
import net from 'node:net';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const LISTEN = +arg('listen', 47101);
const TARGET = +arg('target', 47100);
const DELAY = +arg('delay-ms', 0);
const JITTER = +arg('jitter-ms', 0);
const STALL_P = +arg('stall-p', 0);
const STALL_MS = +arg('stall-ms', 200);
const DOWN = +arg('down-kbps', 0) * 125; // bytes per second
const UP = +arg('up-kbps', 0) * 125;
const DROPS = (arg('drop-at-ms', '') || '').split(',').filter(Boolean).map(Number);
const HOLE_AT = +arg('hole-at-ms', -1);
const HOLE_MS = +arg('hole-ms', 0);
const QUEUE_MS = +arg('queue-ms', 300); // bufferbloat: the bottleneck queue holds at most this much delay
// One shared FIFO bottleneck per direction, as in a home router: every connection through this proxy
// (control and bulk sockets alike) queues behind the others. Beyond QUEUE_MS the sources are paused,
// so TCP flow control pushes back into the sender's buffers.
const links = { up: { rate: UP, busyUntil: 0, paused: new Set() }, down: { rate: DOWN, busyUntil: 0, paused: new Set() } };
setInterval(() => {
  const now = performance.now();
  for (const l of Object.values(links)) {
    if (l.paused.size && l.busyUntil - now < QUEUE_MS / 2) {
      for (const s of l.paused) s.resume();
      l.paused.clear();
    }
  }
}, 5);
const t0 = performance.now();
const pairs = new Set();
let seed = 12345;
const rnd = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
};

function lane(src, dst, link) {
  const q = [];
  let last = 0;
  let timer = null;
  const drain = () => {
    timer = null;
    const now = performance.now();
    while (q.length && q[0].t <= now) dst.write(q.shift().buf);
    if (q.length) timer = setTimeout(drain, Math.max(0, q[0].t - now));
  };
  src.on('data', (buf) => {
    const now = performance.now();
    let depart = now;
    if (link.rate > 0) {
      link.busyUntil = Math.max(link.busyUntil, now) + (buf.length / link.rate) * 1000;
      depart = link.busyUntil;
      if (depart - now > QUEUE_MS) {
        src.pause();
        link.paused.add(src);
      }
    }
    let t = depart + DELAY + rnd() * JITTER;
    if (rnd() < STALL_P) t += STALL_MS; // retransmission after a loss
    const rel = now - t0;
    if (HOLE_AT >= 0 && rel >= HOLE_AT && rel < HOLE_AT + HOLE_MS) t = Math.max(t, t0 + HOLE_AT + HOLE_MS + DELAY);
    t = Math.max(t, last); // in-order delivery, as TCP guarantees
    last = t;
    q.push({ t, buf });
    if (!timer) timer = setTimeout(drain, Math.max(0, q[0].t - now));
  });
}

net
  .createServer((client) => {
    const up = net.connect(TARGET, '127.0.0.1');
    client.setNoDelay(true);
    up.setNoDelay(true);
    const pair = { client, up };
    pairs.add(pair);
    lane(client, up, links.up);
    lane(up, client, links.down);
    const end = () => {
      pairs.delete(pair);
      client.destroy();
      up.destroy();
    };
    client.on('error', end);
    up.on('error', end);
    client.on('close', end);
    up.on('close', end);
  })
  .listen(LISTEN, '127.0.0.1');

for (const at of DROPS)
  setTimeout(() => {
    for (const p of pairs) {
      p.client.destroy();
      p.up.destroy();
    }
    process.stderr.write(`${JSON.stringify({ netem: LISTEN, dropped: at })}\n`);
  }, at);

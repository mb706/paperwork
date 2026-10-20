// Production statistics (P; I §4.12, 07 §11) at M0's scope, on the real STATS projection (10 §15.5): the nine
// time ranges, the tabs (Items, Fluids, Buildings, Heat; Containment arrives with its system), and the
// Production and Consumption halves, each a Canvas2D line graph of the series (the y axis auto-scaled) over a
// list of rows: icon with the window's total as its badge, a bar relative to the top row, the rate per minute;
// sorted by rate. M0's statistics are hand-mined and hand-crafted items (golden rule 26).
import { createComputed, createEffect, createSignal, For, type JSX, on, onCleanup, Show } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { useServices } from '../core/context.ts';
import { Icon } from '../core/Icon.tsx';
import { useTip } from '../core/tip.ts';
import { Window } from '../core/Window.tsx';
import { formatCount, formatRate, t } from '../i18n/locale.ts';
import {
  type HeldSeries,
  PRECISION_SECONDS,
  type StatRow as Row,
  type StatsView,
  statId,
  statKind,
  statRows,
} from '../store/records.ts';
import { LAYER } from '../store/ui.ts';

const TABS = ['items', 'fluids', 'buildings', 'heat'] as const;
export function StatsWindow(): JSX.Element {
  const s = useServices();
  const [precision, setPrecision] = createSignal(1);
  const [tab, setTab] = createSignal(0);
  const watch = s.game.watchStats(precision(), tab());
  onCleanup(watch.dispose);
  createEffect(on([precision, tab], ([p, tb]) => watch.set(p, tb), { defer: true }));
  /** The rows of one half, reconciled by StatKey: a changed rate updates its row in place (C5-r1 15). */
  const rows = (side: 'produced' | 'consumed') => {
    const [list, setList] = createStore<Row[]>([]);
    createComputed(() => setList(reconcile(statRows(watch.stats(), side, s.game.tick[0]()), { key: 'key' })));
    return () => list;
  };
  const produced = rows('produced');
  const consumed = rows('consumed');
  return (
    <Window
      id="stats"
      title={t('window.production-statistics')}
      onClose={() => s.ui.close()}
      layer={LAYER.window}
      testid="window-stats"
    >
      <div class="stats-precisions" data-testid="stats-precisions">
        <For each={PRECISION_SECONDS}>
          {(_x, i) => (
            <button
              type="button"
              class={`precision ${precision() === i() ? 'pw-button-pressed' : 'pw-button'}`}
              onClick={() => setPrecision(i())}
              data-testid={`precision-${i()}`}
            >
              <span class="typed">{t(`stats.precision-${i()}`)}</span>
            </button>
          )}
        </For>
      </div>
      <div class="tabs">
        <For each={TABS}>
          {(x, i) => (
            <button
              type="button"
              class={`tab ${tab() === i() ? 'pw-tab-selected' : 'pw-tab'}`}
              onClick={() => setTab(i())}
              data-testid={`stats-tab-${x}`}
            >
              {t(`stats.${x}`)}
            </button>
          )}
        </For>
      </div>
      <div class="stats-halves">
        <StatsHalf title={t('stats.production')} rows={produced()} stats={watch.stats()} side="produced" />
        <StatsHalf title={t('stats.consumption')} rows={consumed()} stats={watch.stats()} side="consumed" />
      </div>
    </Window>
  );
}

function StatsHalf(props: {
  title: string;
  rows: Row[];
  stats: StatsView | null;
  side: 'produced' | 'consumed';
}): JSX.Element {
  const s = useServices();
  const top = () => props.rows[0]?.rate ?? 0;
  const icon = (key: number) =>
    statKind(key) === 1 ? (s.protos()?.itemIcon(statId(key)) ?? 'fx/missing') : 'fx/missing';
  const name = (key: number) => (statKind(key) === 1 ? (s.protos()?.itemName(statId(key)) ?? '') : '');
  return (
    <div class="panel pw-panel stats-half" data-testid={`stats-${props.side}`}>
      <h2 class="panel-title">{props.title}</h2>
      <Graph stats={props.stats} rows={props.rows} side={props.side} />
      <div class="stats-rows">
        <For each={props.rows}>
          {(r) => (
            <div
              class="stats-row"
              data-testid={`stats-row-${props.side}`}
              {...useTip(() => (statKind(r.key) === 1 ? { kind: 'item', id: statId(r.key) } : null))}
            >
              <span class="stats-icon">
                <Icon name={icon(r.key)} size={32} label={name(r.key)} />
                <span class="count">{formatCount(Math.round(r.total))}</span>
              </span>
              <span class="stats-bar">
                <span style={{ width: `${top() > 0 ? (100 * r.rate) / top() : 0}%`, background: r.colour }} />
              </span>
              <span class="typed stats-rate">{t('stats.per-minute', formatRate(r.rate))}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

/** The line graph (Canvas2D, I §8.1): one line per row's series, the y axis from 0 to the largest point. */
function Graph(props: { stats: StatsView | null; rows: Row[]; side: 'produced' | 'consumed' }): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  const W = 360;
  const H = 120;
  createEffect(() => {
    const v = props.stats;
    const rows = props.rows;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== W * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(169, 191, 208, 0.9)';
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = Math.round((H * i) / 4) + 0.5;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    if (!v) return;
    const lines: { s: HeldSeries; colour: string }[] = [];
    let max = 0;
    for (const r of rows) {
      const ser = v.series.get(r.key);
      if (!ser) continue;
      lines.push({ s: ser, colour: r.colour });
      for (const x of ser[props.side]) if (x > max) max = x;
    }
    if (max <= 0) return;
    for (const { s: ser, colour } of lines) {
      const pts = ser[props.side];
      g.strokeStyle = colour;
      g.lineWidth = 1.5;
      g.beginPath();
      pts.forEach((p, i) => {
        const x = W - (pts.length - 1 - i) * (W / 299);
        const y = H - 2 - (p / max) * (H - 6);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
    }
    g.fillStyle = '#5d5345';
    g.font = "11px 'Courier Prime', monospace";
    g.fillText(formatCount(Math.round(max)), 4, 11);
  });
  return (
    <Show when={true}>
      <canvas ref={canvas} class="graph" style={{ width: `${W}px`, height: `${H}px` }} />
    </Show>
  );
}

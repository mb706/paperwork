// An icon from the DOM icon sheets (10 §9.3, §15.7 `dom`): the 64-px sheet drawn at 32 CSS px stays crisp at
// device pixel ratio 2; the 32-px sheet serves 16-px icons. An icon the art does not have yet is drawn as a
// typed index tab with the item's initials (a stand-in until the asset build renders it).
import { type JSX, Show } from 'solid-js';
import { useServices } from './context.ts';
import { initials } from './initials.ts';

export function Icon(props: { name: string; size?: number; label?: string; class?: string }): JSX.Element {
  const s = useServices();
  const size = () => props.size ?? 32;
  const style = (): JSX.CSSProperties | undefined => {
    const p = s.protos();
    if (!p?.hasIcon(props.name)) return undefined;
    const ref = p.icon(props.name);
    if (!ref) return undefined;
    const url = p.sheet(ref.group, size() > 32 ? 64 : 64);
    if (!url) return undefined;
    const z = size();
    const col = ref.index % ref.columns;
    const row = Math.floor(ref.index / ref.columns);
    return {
      width: `${z}px`,
      height: `${z}px`,
      'background-image': `url("/${url}")`,
      'background-size': `${ref.columns * z}px ${ref.rows * z}px`,
      'background-position': `-${col * z}px -${row * z}px`,
    };
  };
  return (
    <Show
      when={style()}
      fallback={
        <span
          class={`icon icon-missing ${props.class ?? ''}`}
          style={{
            width: `${size()}px`,
            height: `${size()}px`,
            'font-size': `${Math.max(8, size() * 0.34)}px`,
          }}
        >
          {initials(props.label ?? props.name.replace(/^.*\//, ''))}
        </span>
      }
    >
      {(st) => <span class={`icon ${props.class ?? ''}`} style={st()} />}
    </Show>
  );
}

/** The glyph sprite (10 §9.3: arrows, ⇒, warning and status icons are SVG paths, never font glyphs). */
export function Glyph(props: { name: string; size?: number }): JSX.Element {
  const s = useServices();
  const href = () => {
    const g = s.dom?.ui.glyphs;
    return g ? `/${g}#g-${props.name}` : `#g-${props.name}`;
  };
  return (
    <svg class="glyph" width={props.size ?? 18} height={props.size ?? 18} aria-hidden="true">
      <use href={href()} />
    </svg>
  );
}

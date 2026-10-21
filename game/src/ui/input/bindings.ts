// The live binding table (I §1.1, §1.6; 10 §7.5): the defaults of controls.ts with the player's overrides,
// matched against physical inputs, and the settings shape the Controls screen edits (rebinding UI: M1).
//
// Settings shape (client-only, 10 §7.6: never sent to the sim). JSON, versioned:
//   { "version": 1, "overrides": { "<control id>": { "primary"?: Binding | null, "alternative"?: Binding | null } } }
// An absent column keeps the default; null clears it. Unknown control ids are kept (a later build may know
// them) but ignored. Conflicts are allowed and listed (I §1.1: shared bindings are intentional).
import { type Binding, CONTROL_BY_ID, CONTROLS, type ControlDef, sameBinding } from './controls.ts';

export interface BindingOverride {
  primary?: Binding | null;
  alternative?: Binding | null;
}

export interface KeybindingSettings {
  version: 1;
  overrides: Record<string, BindingOverride>;
}

export const defaultKeybindings = (): KeybindingSettings => ({ version: 1, overrides: {} });

const isBinding = (v: unknown): v is Binding =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Binding).code === 'string' &&
  (v as Binding).code.length > 0 &&
  Number.isInteger((v as Binding).mods) &&
  (v as Binding).mods >= 0 &&
  (v as Binding).mods <= 7;

/** Parses stored settings; anything malformed falls back to the default for that entry. */
export function sanitizeKeybindings(raw: unknown): KeybindingSettings {
  const out = defaultKeybindings();
  if (typeof raw !== 'object' || raw === null || (raw as KeybindingSettings).version !== 1) return out;
  const o = (raw as KeybindingSettings).overrides;
  if (typeof o !== 'object' || o === null) return out;
  for (const [id, v] of Object.entries(o)) {
    if (typeof v !== 'object' || v === null) continue;
    const e: BindingOverride = {};
    for (const col of ['primary', 'alternative'] as const) {
      const b = (v as BindingOverride)[col];
      if (b === null) e[col] = null;
      else if (isBinding(b)) e[col] = { code: b.code, mods: b.mods };
    }
    if ('primary' in e || 'alternative' in e) out.overrides[id] = e;
  }
  return out;
}

export interface Match {
  control: ControlDef;
  /** The modifiers equal the binding's exactly (press controls need this; hold controls accept a superset). */
  exact: boolean;
}

export class BindingTable {
  private readonly byCode = new Map<string, { control: ControlDef; binding: Binding }[]>();
  private readonly effective = new Map<string, [Binding | null, Binding | null]>();
  readonly settings: KeybindingSettings;

  constructor(settings: KeybindingSettings = defaultKeybindings()) {
    this.settings = settings;
    for (const c of CONTROLS) {
      const o = settings.overrides[c.id];
      const primary = o && 'primary' in o ? (o.primary ?? null) : c.primary;
      const alternative = o && 'alternative' in o ? (o.alternative ?? null) : c.alternative;
      this.effective.set(c.id, [primary, alternative]);
      for (const b of [primary, alternative]) {
        if (!b) continue;
        const list = this.byCode.get(b.code) ?? [];
        list.push({ control: c, binding: b });
        this.byCode.set(b.code, list);
      }
    }
  }

  /** The effective [primary, alternative] of a control. */
  get(id: string): [Binding | null, Binding | null] {
    return this.effective.get(id) ?? [null, null];
  }

  /**
   * The controls an input with these modifiers triggers (I §1.1): press controls on an exact modifier match,
   * hold controls also when the input carries extra modifiers (walk while holding Shift). Exact matches first,
   * then in the action map's order; each control once.
   */
  match(code: string, mods: number): Match[] {
    const list = this.byCode.get(code);
    if (!list) return [];
    const exact: Match[] = [];
    const loose: Match[] = [];
    const seen = new Set<string>();
    for (const { control, binding } of list) {
      if (binding.mods === mods) {
        if (!seen.has(control.id)) exact.push({ control, exact: true });
        seen.add(control.id);
      }
    }
    for (const { control, binding } of list) {
      if (seen.has(control.id) || !control.hold) continue;
      if ((binding.mods & mods) === binding.mods) {
        loose.push({ control, exact: false });
        seen.add(control.id);
      }
    }
    return [...exact, ...loose];
  }

  /** Whether `id` is bound to exactly this input (either column). */
  bound(id: string, code: string, mods: number): boolean {
    const [p, a] = this.get(id);
    return (
      (p !== null && p.code === code && p.mods === mods) || (a !== null && a.code === code && a.mods === mods)
    );
  }

  /**
   * The controls that share a binding with `id` where the defaults did not (I §1.1: the Controls screen warns
   * about conflicts but allows them; Factorio's own shared defaults, LMB and Shift+LMB, are not conflicts).
   */
  conflicts(id: string): string[] {
    const out = new Set<string>();
    const def = CONTROL_BY_ID.get(id);
    for (const b of this.get(id)) {
      if (!b) continue;
      for (const { control } of this.byCode.get(b.code) ?? []) {
        if (control.id === id || !this.bound(control.id, b.code, b.mods)) continue;
        const other = CONTROL_BY_ID.get(control.id);
        const sharedByDefault =
          def !== undefined &&
          other !== undefined &&
          [def.primary, def.alternative].some((x) => sameBinding(x, b)) &&
          [other.primary, other.alternative].some((x) => sameBinding(x, b));
        if (!sharedByDefault) out.add(control.id);
      }
    }
    return [...out];
  }

  /** A copy with one column of one control rebound (null clears it); `undefined` restores the default. */
  rebind(id: string, column: 'primary' | 'alternative', b: Binding | null | undefined): BindingTable {
    const overrides = { ...this.settings.overrides };
    const o: BindingOverride = { ...(overrides[id] ?? {}) };
    if (b === undefined) delete o[column];
    else o[column] = b;
    if ('primary' in o || 'alternative' in o) overrides[id] = o;
    else delete overrides[id];
    return new BindingTable({ version: 1, overrides });
  }
}

// The UI's view of the prototype build (10 §15.2, §7.6: "all UI behaviour comes from prototype data"): display
// names through the data's locale keys, icons through the sprite manifest's DOM sheets (§9.3, §15.7), the
// crafting panel's layout from item groups, subgroups and order strings (I §4.4, §7.2), and the selection and
// collision boxes the resolver needs. Nothing here is a rule of the game; the sim validates every action.
import type { JsonEntity, JsonItem, JsonRecipe, PrototypesJson } from '../../shared/gen/protos.ts';
import { dataString } from '../i18n/locale.ts';

/** The character's numbers the UI uses for reach hints (prototypes.bin's character row; I §3.1). */
export interface CharacterFacts {
  reach: number;
  build: number;
  resourceReach: number;
}

export const DEFAULT_CHARACTER: CharacterFacts = { reach: 10, build: 10, resourceReach: 2.7 };

export interface IconRef {
  /** The sheet group (sprite manifest `dom.icons`), e.g. 'core'. */
  group: string;
  index: number;
  columns: number;
  rows: number;
}

/** The sprite manifest's DOM part (§15.7 `dom`; written by the asset build, C6). */
export interface DomManifest {
  icons: Record<string, string[]>;
  iconSheets: Record<string, { columns: number; names: string[]; bytes?: number[] }>;
  ui: { css: string; fibre: string; glyphs: string };
  fonts: string;
}

export interface RecipeRow {
  subgroup: number;
  recipes: number[];
}

export interface CraftGroup {
  group: number;
  name: string;
  rows: RecipeRow[];
}

/** An item key's id: (key >> 3), quality in the low 3 bits (§4.3). */
export const itemOfKey = (key: number): number => key >> 3;
export const NO_ITEM = 0xffff;

export class Protos {
  readonly json: PrototypesJson;
  readonly character: CharacterFacts;
  private readonly icons = new Map<string, IconRef>();
  readonly dom: DomManifest | null;
  readonly craftGroups: CraftGroup[];
  private readonly itemByName = new Map<string, number>();

  constructor(json: PrototypesJson, dom: DomManifest | null, character: CharacterFacts = DEFAULT_CHARACTER) {
    this.json = json;
    this.dom = dom;
    this.character = character;
    json.item.forEach((it, i) => {
      this.itemByName.set(it.name, i);
    });
    if (dom)
      for (const [group, sheet] of Object.entries(dom.iconSheets)) {
        const rows = Math.ceil(sheet.names.length / sheet.columns);
        sheet.names.forEach((name, index) => {
          this.icons.set(name, { group, index, columns: sheet.columns, rows });
        });
      }
    this.craftGroups = this.buildCraftGroups();
  }

  item(id: number): JsonItem | undefined {
    return this.json.item[id];
  }

  itemByKey(key: number): JsonItem | undefined {
    return key === NO_ITEM ? undefined : this.json.item[itemOfKey(key)];
  }

  itemId(name: string): number | undefined {
    return this.itemByName.get(name);
  }

  itemName(key: number): string {
    const it = this.itemByKey(key);
    return it ? dataString(it.localeName, it.name) : '';
  }

  itemDescription(key: number): string {
    const it = this.itemByKey(key);
    return it ? dataString(it.localeDescription) : '';
  }

  stackSize(key: number): number {
    return this.itemByKey(key)?.stack ?? 1;
  }

  recipe(id: number): JsonRecipe | undefined {
    return this.json.recipe[id];
  }

  recipeName(id: number): string {
    const r = this.json.recipe[id];
    return r ? dataString(r.localeName, r.name) : '';
  }

  entity(id: number): JsonEntity | undefined {
    return this.json.entity[id];
  }

  entityName(id: number): string {
    const e = this.json.entity[id];
    return e ? dataString(e.localeName, e.name) : '';
  }

  entityDescription(id: number): string {
    const e = this.json.entity[id];
    return e ? dataString(e.localeDescription) : '';
  }

  resourceName(id: number): string {
    const r = this.json.resource[id];
    return r ? dataString(r.localeName, r.name) : '';
  }

  /** The entity an item key places, or undefined (I §1.4 "placeable"). */
  places(key: number): number | undefined {
    const p = this.itemByKey(key)?.places;
    return p === null || p === undefined ? undefined : p;
  }

  /** An icon by its manifest name (`item/iron-plate`), else the manifest's missing-icon frame. */
  icon(name: string): IconRef | null {
    return this.icons.get(name) ?? this.icons.get('fx/missing') ?? null;
  }

  hasIcon(name: string): boolean {
    return this.icons.has(name);
  }

  itemIcon(key: number): string {
    return this.itemByKey(key)?.icon ?? 'fx/missing';
  }

  /** The 32- or 64-px sheet URL of a group (the 64-px sheet scaled down is crisp at dpr 2). */
  sheet(group: string, size: 32 | 64): string | null {
    const files = this.dom?.icons[group];
    if (!files) return null;
    return (size === 32 ? files[0] : files[1]) ?? files[0] ?? null;
  }

  /**
   * The crafting panel's tabs (I §4.4): item groups that hold an enabled recipe, each with one row per item
   * subgroup, recipes sorted by order string (Factorio's layout; 07 §1: the groups of the data).
   */
  private buildCraftGroups(): CraftGroup[] {
    const groups = new Map<number, Map<number, number[]>>();
    this.json.recipe.forEach((r, id) => {
      if (!r.enabledAtStart) return;
      const g = groups.get(r.group) ?? new Map<number, number[]>();
      const list = g.get(r.subgroup) ?? [];
      list.push(id);
      g.set(r.subgroup, list);
      groups.set(r.group, g);
    });
    const order = (s: string | undefined) => s ?? '';
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    return [...groups.entries()]
      .sort((a, b) => cmp(order(this.json.groups[a[0]]?.order), order(this.json.groups[b[0]]?.order)))
      .map(([group, subs]) => ({
        group,
        name: this.json.groups[group]?.name ?? '',
        rows: [...subs.entries()]
          .sort((a, b) =>
            cmp(order(this.json.subgroups[a[0]]?.order), order(this.json.subgroups[b[0]]?.order)),
          )
          .map(([subgroup, recipes]) => ({
            subgroup,
            recipes: recipes.sort(
              (x, y) =>
                cmp(this.json.recipe[x]?.order ?? '', this.json.recipe[y]?.order ?? '') ||
                cmp(this.json.recipe[x]?.name ?? '', this.json.recipe[y]?.name ?? ''),
            ),
          })),
      }));
  }

  /**
   * The group's tab icon (the data has no group icons yet): its first recipe whose icon the art has, else its
   * first recipe's (drawn as the stand-in).
   */
  groupIcon(g: CraftGroup): string {
    for (const row of g.rows)
      for (const id of row.recipes) {
        const icon = this.json.recipe[id]?.icon;
        if (icon && this.icons.has(icon)) return icon;
      }
    const first = g.rows[0]?.recipes[0];
    return first === undefined ? 'fx/missing' : (this.json.recipe[first]?.icon ?? 'fx/missing');
  }

  /** Selection box, turned for east and west, around an entity's centre (tiles). */
  selectionBox(proto: number, dir: number): [number, number, number, number] {
    return turn(this.json.entity[proto]?.selectionBox ?? [-0.5, -0.5, 0.5, 0.5], dir);
  }

  collisionBox(proto: number, dir: number): [number, number, number, number] {
    return turn(this.json.entity[proto]?.collisionBox ?? [-0.4, -0.4, 0.4, 0.4], dir);
  }

  /** The footprint in tiles, turned for east and west. */
  size(proto: number, dir: number): [number, number] {
    const s = this.json.entity[proto]?.size ?? [1, 1];
    const w = s[0] ?? 1;
    const h = s[1] ?? 1;
    return dir === 4 || dir === 12 ? [h, w] : [w, h];
  }
}

function turn(b: readonly number[], dir: number): [number, number, number, number] {
  const [x0 = -0.5, y0 = -0.5, x1 = 0.5, y1 = 0.5] = b;
  return dir === 4 || dir === 12 ? [y0, x0, y1, x1] : [x0, y0, x1, y1];
}

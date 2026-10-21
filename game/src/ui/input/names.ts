// Control display names (08 §5.1 #24: Factorio's, renamed per §10): locale `controls.<id>`; the numbered quickbar
// controls share one string with their number.
import { t } from '../i18n/locale.ts';

const NUMBERED = /^(quick-bar-button|action-bar-select-page)-(\d+)(-secondary)?$/;

export function controlNameKey(id: string): string {
  const m = NUMBERED.exec(id);
  return m ? `controls.${m[1]}${m[3] ?? ''}` : `controls.${id}`;
}

export function controlName(id: string): string {
  const m = NUMBERED.exec(id);
  return m ? t(controlNameKey(id), Number(m[2])) : t(controlNameKey(id));
}

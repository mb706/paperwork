// The codec's error kinds, shared by the Rust and TypeScript runtimes and the probe fixtures. Append only:
// the names appear in test/fixtures/codec/probes.txt.
export const ERROR_KINDS: readonly (readonly [string, string])[] = [
  ['truncated', 'The bytes end inside a value.'],
  ['trailing', 'Bytes are left after the value.'],
  ['bad_enum', 'An enum value (or a tag) the schema does not declare.'],
  ['bad_flags', 'A flag bit the schema does not declare.'],
  ['bad_bool', 'A bool that is neither 0 nor 1.'],
  ['reserved', 'A reserved field or padding that is not zero.'],
  ['range', 'An integer outside its declared range or allowed values.'],
  ['too_long', 'A str, bytes or list over its max.'],
  ['bad_utf8', 'A str that is not valid UTF-8.'],
  ['bad_ref', 'An EntityRef whose fields do not match its tag (§15.3).'],
  ['not_a_number', 'A NaN: no NaN crosses the boundary (D6).'],
  ['bad_length', 'A length that does not match its value.'],
  ['unknown_type', 'An action, event, record or section type the schema does not declare.'],
  ['field_order', 'Record fields not in ascending id, or an id twice (§8.1).'],
  ['unknown_field', 'A record field id the schema does not declare (strict records).'],
  ['missing_field', 'A record field that is absent (strict records).'],
  ['unsorted', 'Keyed items or records out of their canonical order, or a duplicate (§8.1, D3).'],
  ['bad_magic', 'A magic number that does not match.'],
  ['bad_version', 'A version this build does not read.'],
  ['bad_count', 'A count that does not fit its field, or arrays sharing a count that disagree.'],
  ['inconsistent', 'A flag and the field it announces disagree.'],
  ['schema_mismatch', 'A saved column or record whose type this schema cannot read (ERR_LOAD_SCHEMA).'],
  ['not_canonical', 'Bytes that decode but are not the canonical encoding (a free row off its defaults).'],
];

/** Rust's variant name: `bad_enum` → `BadEnum`. */
export function rustKind(name: string): string {
  return name.replace(/(^|_)([a-z])/g, (_m, _p, c: string) => c.toUpperCase());
}

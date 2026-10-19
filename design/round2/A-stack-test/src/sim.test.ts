import { expect, test } from 'vitest';
import { step } from './sim';
test('deterministic', () => { expect(step(new Int32Array(10), 3)).toBe(step(new Int32Array(10), 3)); });

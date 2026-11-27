// Added for Mistwarden on 2026-11-27.
import { expect, it } from 'vitest';
import { totp } from './totp.ts';

it('matches the RFC 6238 SHA-1 test vector', () => {
  // Secret "12345678901234567890"; at 59 s the 8-digit code is 94287082.
  expect(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000)).toBe('287082');
});

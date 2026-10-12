import { describe, expect, it } from 'vitest';
import { clampFloatingPosition } from './floatingWindow';
import { emptyLibrary, validateLibrary } from './domain';

describe('reading workspace upgrades', () => {
  it('keeps the translation window reachable at each viewport edge', () => {
    const size = { width: 355, height: 440 }, viewport = { width: 1000, height: 650 };
    expect(clampFloatingPosition({ x: 900, y: 600 }, size, viewport)).toEqual({ x: 637, y: 202 });
    expect(clampFloatingPosition({ x: -500, y: -500 }, size, viewport)).toEqual({ x: 8, y: 8 });
    expect(clampFloatingPosition({ x: 80, y: 90 }, size, viewport)).toEqual({ x: 80, y: 90 });
    expect(clampFloatingPosition({ x: 900, y: 600 }, size, { width: 300, height: 250 })).toEqual({ x: 8, y: 8 });
  });
  it('enables automatic translation for old libraries without overwriting a later opt-out', () => {
    const old = emptyLibrary(); delete old.settings.translationModeVersion; old.settings.autoTranslate = false;
    const upgraded = validateLibrary(old);
    expect(upgraded.settings.autoTranslate).toBe(true);
    expect(old.settings.autoTranslate).toBe(false);
    upgraded.settings.autoTranslate = false;
    expect(validateLibrary(upgraded).settings.autoTranslate).toBe(false);
    expect(emptyLibrary().settings.autoTranslate).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyCalculatorRowsToTakeoff,
  buildMaterialRows,
  makeId,
  matchTemplate,
  normalizedToDisplay,
  measureRunGroups,
  measureAreaGroups,
  parseNumber,
  removeDuplicateCandidates,
  rowsToCsv,
} from '../src/core.js';
import { SAMPLE_FIXTURES, SAMPLE_REFERENCE_COUNTS } from '../src/samplePlan.js';
import { createDefaultState, WorkspaceStore, workspaceKey } from '../src/storage.js';

function imageData(width, height, draw) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 255; data[index * 4 + 1] = 255; data[index * 4 + 2] = 255; data[index * 4 + 3] = 255;
  }
  const set = (x, y, r, g = r, b = r) => {
    const index = (y * width + x) * 4;
    data[index] = r; data[index + 1] = g; data[index + 2] = b; data[index + 3] = 255;
  };
  draw?.(set);
  return { data, width, height };
}

function drawSymbol(set, x, y) {
  // A simple high-contrast toilet-like glyph used only for matcher mechanics tests.
  for (let py = y + 4; py < y + 13; py += 1) for (let px = x + 3; px < x + 15; px += 1) set(px, py, 25);
  for (let py = y + 11; py < y + 22; py += 1) {
    for (let px = x + 1; px < x + 17; px += 1) {
      const d = ((px - (x + 9)) / 8) ** 2 + ((py - (y + 16)) / 6) ** 2;
      if (d <= 1) set(px, py, 35);
    }
  }
}

function fixtureState(overrides = {}) {
  return { ...createDefaultState(), ...overrides };
}

describe('Material Calculator V1 core', () => {
  it('uses the manually checked sample physical count, collapsing repeated views', () => {
    const physical = new Map();
    for (const fixture of SAMPLE_FIXTURES) {
      if (!physical.has(fixture.physicalId)) physical.set(fixture.physicalId, fixture.category);
    }
    const counts = {};
    for (const category of physical.values()) counts[category] = (counts[category] || 0) + 1;
    expect(counts).toEqual(SAMPLE_REFERENCE_COUNTS);
    expect(SAMPLE_FIXTURES).toHaveLength(9);
    expect(physical.size).toBe(7); // two enlarged-view references are not extra fixtures
  });

  it('keeps uncertain visual matches out of counted quantities until approved', () => {
    const state = fixtureState({ marks: [
      { id: 'm1', page: 1, x: .2, y: .3, category: 'toilet', status: 'counted', quantity: 1, material: 'Ceramic', size: 'Floor mount' },
      { id: 'candidate', page: 1, x: .4, y: .3, category: 'toilet', status: 'review', quantity: 1, material: 'Ceramic', size: 'Floor mount' },
    ] });
    const rows = buildMaterialRows(state);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ item: 'Toilet', quantity: 1, material: 'Ceramic', size: 'Floor mount', kind: 'counted' });
    state.marks[1].status = 'counted';
    expect(buildMaterialRows(state).find((row) => row.item === 'Toilet').quantity).toBe(2);
  });

  it('parses grouped dimensions such as 6,000 mm and rejects empty inputs', () => {
    expect(parseNumber('6,000 mm')).toBe(6000);
    expect(parseNumber('1 200')).toBe(1200);
    expect(parseNumber('2.75 m')).toBe(2.75);
    expect(Number.isNaN(parseNumber(''))).toBe(true);
  });

  it('keeps plan evidence aligned when the same normalized mark is zoomed or resized', () => {
    const pagePoint = { x: .375, y: .68 };
    const atFit = normalizedToDisplay(pagePoint, 600, 425);
    const atZoom = normalizedToDisplay(pagePoint, 1200, 850);
    expect(atFit).toEqual({ x: 225, y: 289 });
    expect(atZoom).toEqual({ x: 450, y: 578 });
    expect(atFit.x / 600).toBe(atZoom.x / 1200);
    expect(atFit.y / 425).toBe(atZoom.y / 850);
  });

  it('measures a shared collinear route segment once on the same sheet', () => {
    const runs = [
      { id: 'a', page: 1, material: 'PVC', size: '50 mm', points: [{ x: .1, y: .1 }, { x: .6, y: .1 }] },
      { id: 'b', page: 1, material: 'PVC', size: '50 mm', points: [{ x: .3, y: .1 }, { x: .8, y: .1 }] },
      { id: 'c', page: 1, material: 'PVC', size: '50 mm', points: [{ x: .8, y: .1 }, { x: .6, y: .1 }] },
    ];
    const result = measureRunGroups(runs, { 1: { mmPerPaperUnit: 10 } }, { 1: { width: 1000, height: 500 } });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].metres).toBeCloseTo(7, 7);
    expect(result.unscaled).toHaveLength(0);
  });

  it('does not report lengths for uncalibrated pages, while keeping the route for later', () => {
    const run = { id: 'unscaled', page: 2, material: 'Copper', size: '15 mm', points: [{ x: .1, y: .1 }, { x: .8, y: .5 }] };
    const state = fixtureState({ runs: [run], pageDimensions: { 2: { width: 1000, height: 700 } } });
    const rows = buildMaterialRows(state);
    expect(rows.filter((row) => row.kind === 'measured')).toHaveLength(0);
    expect(state.runs).toHaveLength(1);
    state.calibrations[2] = { mmPerPaperUnit: 2 };
    expect(buildMaterialRows(state).find((row) => row.kind === 'measured').quantity).toBeGreaterThan(0);
  });

  it('requires page calibration for area and reports the calibrated polygon area in square metres', () => {
    const area = { id: 'area-1', page: 1, item: 'Bedding footprint', material: 'Sand', size: '100 mm', points: [
      { x: .1, y: .1 }, { x: .5, y: .1 }, { x: .5, y: .5 }, { x: .1, y: .5 },
    ] };
    const unscaled = measureAreaGroups([area], {}, { 1: { width: 1000, height: 500 } });
    expect(unscaled.groups).toHaveLength(0);
    expect(unscaled.unscaled).toHaveLength(1);
    const state = fixtureState({
      areas: [area], pageDimensions: { 1: { width: 1000, height: 500 } },
      calibrations: { 1: { mmPerPaperUnit: 10 } },
    });
    expect(buildMaterialRows(state)).toContainEqual(expect.objectContaining({ item: 'Bedding footprint', quantity: 8, unit: 'm²', kind: 'measured' }));
  });

  it('recalculates waste, clips, trench, bedding, backfill and spoil only from explicit inputs', () => {
    const runs = [
      { id: 'r1', page: 1, material: 'PVC', size: '50 mm', points: [{ x: .1, y: .1 }, { x: .6, y: .1 }] },
      { id: 'r2', page: 1, material: 'PVC', size: '50 mm', points: [{ x: .3, y: .1 }, { x: .8, y: .1 }] },
    ];
    const base = fixtureState({
      runs,
      pageDimensions: { 1: { width: 1000, height: 500 } },
      calibrations: { 1: { mmPerPaperUnit: 10 } },
    });
    const noAssumptions = buildMaterialRows(base);
    expect(noAssumptions.map((row) => row.item)).toEqual(['Pipe run']);
    base.calculationInputs = {
      pipeWastePct: 10, clipSpacingMm: '1,200', trenchWidthMm: '300', trenchDepthMm: '500',
      beddingDepthMm: '100', beddingMaterial: 'Washed sand', spoilExpansionPct: 20,
    };
    const rows = buildMaterialRows(base);
    const byItem = Object.fromEntries(rows.map((row) => [row.item, row]));
    expect(byItem['Pipe run'].quantity).toBe(7);
    expect(byItem['Pipe waste allowance'].quantity).toBe(.7);
    expect(byItem['Pipe clips'].quantity).toBe(6);
    expect(byItem['Trench excavation'].quantity).toBe(1.05);
    expect(byItem.Bedding.quantity).toBe(.21);
    expect(byItem.Backfill.quantity).toBe(.84);
    expect(byItem['Spoil to cart'].quantity).toBe(1.26);
    expect(byItem.Backfill.basis).toContain('excludes pipe displacement');
  });

  it('deduplicates overlapping search results and flags cross-sheet matches for a human decision', () => {
    const existing = [{ id: 'existing', page: 1, x: .2, y: .2, category: 'toilet' }];
    const candidates = [
      { id: 'overlap', page: 1, x: .205, y: .2, category: 'toilet' },
      { id: 'other-page', page: 2, x: .2, y: .2, category: 'toilet' },
    ];
    const result = removeDuplicateCandidates(candidates, existing, { pageSize: .03, globalSize: .02 });
    expect(result.samePageDuplicates).toBe(1);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].possibleRepeatOf).toBe('existing');
    expect(result.matches[0].possibleRepeatPage).toBe(1);
  });

  it('performs same-scale pixel matching as candidates, without implying semantic recognition', () => {
    const template = imageData(20, 26, (set) => drawSymbol(set, 1, 1));
    const source = imageData(100, 80, (set) => { drawSymbol(set, 31, 21); drawSymbol(set, 68, 42); });
    const matches = matchTemplate(source, template, { threshold: .86, stride: 2, maxMatches: 10 });
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((match) => Math.abs(match.x - 31) <= 2 && Math.abs(match.y - 21) <= 2)).toBe(true);
    expect(matches.every((match) => match.score <= 1)).toBe(true);
  });

  it('creates CSV with source pages/references and escaped user values', () => {
    const csv = rowsToCsv([{
      item: 'Pipe, waste', material: 'PVC', size: '6,000 mm', quantity: 6, unit: 'm', basis: 'Measured length',
      sources: [{ type: 'run', id: 'route-1', page: 2, reference: 'Run 01' }],
    }], { 2: 'P-02' });
    expect(csv).toContain('source_page/reference');
    expect(csv).toContain('"Pipe, waste"');
    expect(csv).toContain('P-02 Run 01');
    expect(csv).toContain('6,000 mm');
  });

  it('re-applies calculator quantities idempotently and preserves manual/other-feature lines', () => {
    const row = { key: 'counted|basin|ceramic|white|ea', item: 'Basin', material: 'Ceramic', size: 'White', quantity: 2, unit: 'ea', basis: 'Counted', sources: [] };
    const other = { id: 'other-1', source: 'manual', item: 'Hand-added', quantity: 4 };
    const feature = { id: 'old-calc', source: 'material-calculator', linkedKey: row.key, item: 'Basin', quantity: 1 };
    const takeoff1 = applyCalculatorRowsToTakeoff([other, feature], [row], () => 'new-calc');
    const takeoff2 = applyCalculatorRowsToTakeoff(takeoff1, [{ ...row, quantity: 3 }], () => 'should-not-be-used');
    expect(takeoff2.filter((item) => item.source === 'material-calculator')).toHaveLength(1);
    expect(takeoff2.find((item) => item.source === 'material-calculator')).toMatchObject({ id: 'old-calc', quantity: 3, linkedKey: row.key });
    expect(takeoff2.find((item) => item.id === 'other-1')).toEqual(other);
  });

  it('saves and reopens project/document/page state; retries a failed local save', () => {
    class MemoryStorage {
      values = new Map();
      fail = true;
      getItem(key) { return this.values.get(key) ?? null; }
      setItem(key, value) {
        if (this.fail) { this.fail = false; throw new Error('Quota exceeded'); }
        this.values.set(key, String(value));
      }
    }
    const storage = new MemoryStorage();
    const workspaceStore = new WorkspaceStore(storage);
    const state = createDefaultState();
    state.currentPage = 2;
    state.marks.push({ id: 'p2-mark', page: 2, x: .4, y: .5, category: 'toilet', status: 'counted', material: '', size: '', quantity: 1 });
    state.runs.push({ id: 'p2-run', page: 2, material: 'PVC', size: '40 mm', points: [{ x: .1, y: .1 }, { x: .8, y: .2 }] });
    state.areas.push({ id: 'p2-area', page: 2, item: 'Test area', points: [{ x: .1, y: .1 }, { x: .5, y: .1 }, { x: .5, y: .5 }] });
    state.calibrations[2] = { mmPerPaperUnit: 2, referenceMm: 6000 };
    state.calculationInputs.pipeWastePct = 8;
    state.manualMaterials.push({ id: 'manual-1', page: 2, item: 'Isolation valve', quantity: 2, unit: 'ea' });
    state.takeoff.push({ id: 'linked-1', source: 'material-calculator', linkedKey: 'example', quantity: 2 });
    expect(workspaceKey(state)).toContain('oak-street-renovation:sample-plumbing-v1');
    expect(() => workspaceStore.save(state)).toThrow('Quota exceeded');
    expect(workspaceStore.load(state)).toBeNull();
    const saved = workspaceStore.save(state);
    const reopened = workspaceStore.loadLast();
    expect(reopened).toMatchObject({ currentPage: 2, document: { id: 'sample-plumbing-v1' } });
    expect(reopened.marks[0]).toMatchObject({ page: 2, id: 'p2-mark' });
    expect(reopened.runs[0]).toMatchObject({ page: 2, id: 'p2-run', size: '40 mm' });
    expect(reopened.areas[0]).toMatchObject({ page: 2, id: 'p2-area', item: 'Test area' });
    expect(reopened.calibrations[2]).toMatchObject({ referenceMm: 6000 });
    expect(reopened.calculationInputs.pipeWastePct).toBe(8);
    expect(reopened.manualMaterials[0]).toMatchObject({ item: 'Isolation valve', quantity: 2 });
    expect(reopened.takeoff[0]).toMatchObject({ source: 'material-calculator', quantity: 2 });
    expect(saved.state.updatedAt).toBeTruthy();
  });
});

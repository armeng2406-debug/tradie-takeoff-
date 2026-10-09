export const CATEGORIES = Object.freeze({
  toilet: { label: 'Toilet', short: 'W', material: '', size: '', unit: 'ea' },
  basin: { label: 'Basin', short: 'B', material: '', size: '', unit: 'ea' },
  'floor-waste': { label: 'Floor waste', short: 'F', material: '', size: '', unit: 'ea' },
  shower: { label: 'Shower', short: 'S', material: '', size: '', unit: 'ea' },
  other: { label: 'Other fitting', short: '+', material: '', size: '', unit: 'ea' },
});

export const DEFAULT_CALCULATION_INPUTS = Object.freeze({
  pipeWastePct: 0,
  clipSpacingMm: '',
  trenchWidthMm: '',
  trenchDepthMm: '',
  beddingDepthMm: '',
  spoilExpansionPct: '',
  beddingMaterial: '',
});

export function makeId(prefix = 'item') {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

export function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (value === null || value === undefined) return NaN;
  // Dimension inputs commonly contain grouping commas/spaces: "6,000 mm".
  const cleaned = String(value).trim().replace(/,/g, '').replace(/\s+/g, '').replace(/[a-zA-Z²³%]/g, '');
  if (!cleaned) return NaN;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function normaliseCategory(category) {
  return CATEGORIES[category] ? category : 'other';
}

export function distance(a, b) {
  return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
}

export function normalizedToDisplay(point, width, height) {
  return { x: Number(point?.x ?? 0) * width, y: Number(point?.y ?? 0) * height };
}

export function createCandidateKey(mark) {
  return [mark.category ?? 'other', mark.material ?? '', mark.size ?? ''].join('|').toLocaleLowerCase();
}

export function removeDuplicateCandidates(candidates, existingMarks, { pageSize = 0.035, globalSize = 0.015 } = {}) {
  const kept = [];
  let samePageDuplicates = 0;
  let possibleCrossPageRepeats = 0;
  for (const candidate of candidates) {
    const localHit = [...existingMarks, ...kept].find((item) =>
      item.page === candidate.page &&
      item.category === candidate.category &&
      distance(item, candidate) <= pageSize,
    );
    if (localHit) {
      samePageDuplicates += 1;
      continue;
    }
    const remoteHit = [...existingMarks, ...kept].find((item) =>
      item.page !== candidate.page &&
      item.category === candidate.category &&
      distance(item, candidate) <= globalSize,
    );
    kept.push({
      ...candidate,
      possibleRepeatOf: remoteHit?.id ?? null,
      possibleRepeatPage: remoteHit?.page ?? null,
    });
    if (remoteHit) possibleCrossPageRepeats += 1;
  }
  return { matches: kept, samePageDuplicates, possibleCrossPageRepeats };
}

function cleanSize(value) {
  return String(value ?? '').trim();
}

function stableRowKey(kind, item, material, size, unit) {
  return [kind, item, material, size, unit].map((part) => String(part ?? '').trim().toLocaleLowerCase()).join('|');
}

function sourceRef(type, value, page = null) {
  return {
    type,
    id: value.id,
    page: page ?? value.page ?? null,
    reference: value.reference ?? value.ref ?? null,
    label: value.label ?? null,
  };
}

function mergeSourceRefs(a, b) {
  const seen = new Set(a.map((ref) => `${ref.type}:${ref.id ?? ''}:${ref.page ?? ''}`));
  return [...a, ...b.filter((ref) => {
    const key = `${ref.type}:${ref.id ?? ''}:${ref.page ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })];
}

function pushGroupedRow(rowsByKey, row) {
  const existing = rowsByKey.get(row.key);
  if (existing) {
    existing.quantity += row.quantity;
    existing.sources = mergeSourceRefs(existing.sources, row.sources);
    if (row.formula && !existing.formula) existing.formula = row.formula;
    return existing;
  }
  const created = { ...row, quantity: Number(row.quantity) || 0, sources: [...(row.sources ?? [])] };
  rowsByKey.set(row.key, created);
  return created;
}

function calibrationRatio(calibration) {
  if (!calibration) return NaN;
  const ratio = Number(calibration.mmPerPaperUnit);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : NaN;
}

function projectRunSegments(run, calibration, pageDimensions) {
  const ratio = calibrationRatio(calibration);
  const dimensions = pageDimensions?.[run.page] ?? pageDimensions?.[String(run.page)];
  if (!Number.isFinite(ratio) || !dimensions?.width || !dimensions?.height || !Array.isArray(run.points) || run.points.length < 2) return [];
  const pts = run.points.map((point) => ({
    x: Number(point.x) * Number(dimensions.width) * ratio,
    y: Number(point.y) * Number(dimensions.height) * ratio,
  }));
  const segments = [];
  for (let index = 1; index < pts.length; index += 1) {
    const a = pts[index - 1];
    const b = pts[index];
    const length = distance(a, b);
    if (length > 0.001) segments.push({ a, b, length, runId: run.id, page: run.page });
  }
  return segments;
}

function lineDirection(segment) {
  let dx = segment.b.x - segment.a.x;
  let dy = segment.b.y - segment.a.y;
  const length = Math.hypot(dx, dy);
  dx /= length;
  dy /= length;
  if (dx < 0 || (Math.abs(dx) < 1e-8 && dy < 0)) { dx *= -1; dy *= -1; }
  return { x: dx, y: dy };
}

/**
 * Sum the geometric union of pipe polyline segments for each page/material/size.
 * Collinear overlapping or identical shared segments on a sheet are measured once.
 */
export function measureRunGroups(runs, calibrations, pageDimensions) {
  const groups = new Map();
  const unscaled = [];
  for (const run of runs ?? []) {
    const calibration = calibrations?.[run.page] ?? calibrations?.[String(run.page)];
    const segments = projectRunSegments(run, calibration, pageDimensions);
    if (!segments.length) {
      unscaled.push(run);
      continue;
    }
    const groupKey = `${run.page}|${String(run.material ?? '').trim().toLocaleLowerCase()}|${cleanSize(run.size).toLocaleLowerCase()}`;
    if (!groups.has(groupKey)) groups.set(groupKey, { page: run.page, material: run.material || 'Unspecified', size: run.size || 'Unspecified', segments: [], runs: new Map() });
    const group = groups.get(groupKey);
    group.segments.push(...segments);
    group.runs.set(run.id, run);
  }

  const pageGroups = [];
  for (const group of groups.values()) {
    const lineGroups = new Map();
    for (const segment of group.segments) {
      const direction = lineDirection(segment);
      const normal = { x: -direction.y, y: direction.x };
      const offset = normal.x * segment.a.x + normal.y * segment.a.y;
      const angleBin = Math.round(Math.atan2(direction.y, direction.x) / 0.003);
      const offsetBin = Math.round(offset / 2);
      const key = `${angleBin}:${offsetBin}`;
      const start = direction.x * segment.a.x + direction.y * segment.a.y;
      const end = direction.x * segment.b.x + direction.y * segment.b.y;
      if (!lineGroups.has(key)) lineGroups.set(key, []);
      lineGroups.get(key).push({ start: Math.min(start, end), end: Math.max(start, end), runId: segment.runId });
    }
    let unionMm = 0;
    for (const intervals of lineGroups.values()) {
      intervals.sort((a, b) => a.start - b.start);
      let start = null;
      let end = null;
      for (const interval of intervals) {
        if (start === null) { start = interval.start; end = interval.end; continue; }
        if (interval.start <= end + 0.5) end = Math.max(end, interval.end);
        else { unionMm += end - start; start = interval.start; end = interval.end; }
      }
      if (start !== null) unionMm += end - start;
    }
    pageGroups.push({
      page: group.page,
      material: group.material,
      size: group.size,
      metres: unionMm / 1000,
      runIds: [...group.runs.keys()],
    });
  }

  const totalGroups = new Map();
  for (const pageGroup of pageGroups) {
    const key = `${pageGroup.material.toLocaleLowerCase()}|${pageGroup.size.toLocaleLowerCase()}`;
    if (!totalGroups.has(key)) totalGroups.set(key, { material: pageGroup.material, size: pageGroup.size, metres: 0, pages: new Map(), runIds: new Set(), runPages: new Map() });
    const group = totalGroups.get(key);
    group.metres += pageGroup.metres;
    group.pages.set(pageGroup.page, (group.pages.get(pageGroup.page) ?? 0) + pageGroup.metres);
    pageGroup.runIds.forEach((id) => { group.runIds.add(id); group.runPages.set(id, pageGroup.page); });
  }
  return {
    groups: [...totalGroups.values()].map((group) => ({ ...group, pages: [...group.pages.entries()].map(([page, metres]) => ({ page, metres })), runIds: [...group.runIds], runPages: [...group.runPages.entries()].map(([id, page]) => ({ id, page })) })),
    pageGroups,
    unscaled,
  };
}

export function measureAreaGroups(areas, calibrations, pageDimensions) {
  const groups = new Map();
  const unscaled = [];
  for (const area of areas ?? []) {
    const calibration = calibrations?.[area.page] ?? calibrations?.[String(area.page)];
    const ratio = calibrationRatio(calibration);
    const dimensions = pageDimensions?.[area.page] ?? pageDimensions?.[String(area.page)];
    if (!Number.isFinite(ratio) || !dimensions?.width || !dimensions?.height || !Array.isArray(area.points) || area.points.length < 3) {
      unscaled.push(area);
      continue;
    }
    const points = area.points.map((point) => ({
      x: Number(point.x) * Number(dimensions.width) * ratio,
      y: Number(point.y) * Number(dimensions.height) * ratio,
    }));
    let doubledArea = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      doubledArea += current.x * next.y - next.x * current.y;
    }
    const squareMetres = Math.abs(doubledArea / 2) / 1_000_000;
    if (squareMetres <= 0) continue;
    const item = String(area.item || 'Measured area').trim();
    const material = String(area.material || '').trim() || 'Unspecified';
    const size = String(area.size || '').trim() || 'Unspecified';
    const key = `${area.page}|${item.toLocaleLowerCase()}|${material.toLocaleLowerCase()}|${size.toLocaleLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { page: area.page, item, material, size, squareMetres: 0, areaIds: [] });
    const group = groups.get(key);
    group.squareMetres += squareMetres;
    group.areaIds.push(area.id);
  }
  const totals = new Map();
  for (const pageGroup of groups.values()) {
    const key = `${pageGroup.item.toLocaleLowerCase()}|${pageGroup.material.toLocaleLowerCase()}|${pageGroup.size.toLocaleLowerCase()}`;
    if (!totals.has(key)) totals.set(key, { item: pageGroup.item, material: pageGroup.material, size: pageGroup.size, squareMetres: 0, pages: [], areaIds: [] });
    const total = totals.get(key);
    total.squareMetres += pageGroup.squareMetres;
    total.pages.push({ page: pageGroup.page, squareMetres: pageGroup.squareMetres, areaIds: [...pageGroup.areaIds] });
    total.areaIds.push(...pageGroup.areaIds);
  }
  return { groups: [...totals.values()], pageGroups: [...groups.values()], unscaled };
}

function pushRowsForRunMeasurements(rowsByKey, measurements) {
  for (const group of measurements.groups) {
    const refs = group.runIds.map((id) => {
      const run = measurements.runsById?.get(id);
      const page = group.pages.find((entry) => run && entry.page === run.page)?.page;
      return { type: 'run', id, page: page ?? null, reference: `Run ${String(id).slice(-4)}` };
    });
    const measuredKey = stableRowKey('measured', 'Pipe run', group.material, group.size, 'm');
    pushGroupedRow(rowsByKey, {
      key: measuredKey,
      kind: 'measured', item: 'Pipe run', material: group.material, size: group.size, quantity: group.metres, unit: 'm',
      basis: 'Measured length', formula: 'Unique measured route length; shared collinear segments counted once.', sources: refs,
    });
  }
}

function getMeasuredRows(measurements, rowsByKey, calculationInputs) {
  const sourceByGroup = measurements.groups.map((group) => ({
    ...group,
    refs: group.runIds.map((id) => ({ type: 'run', id, page: group.runPages?.find((entry) => entry.id === id)?.page ?? null, reference: `Run ${String(id).slice(-4)}` })),
  }));
  for (const group of sourceByGroup) {
    pushGroupedRow(rowsByKey, {
      key: stableRowKey('measured', 'Pipe run', group.material, group.size, 'm'), kind: 'measured', item: 'Pipe run',
      material: group.material, size: group.size, quantity: group.metres, unit: 'm', basis: 'Measured length',
      formula: 'Unique measured route length; shared collinear segments counted once.', sources: group.refs,
    });
    const enteredWaste = Number(calculationInputs?.pipeWastePct);
    const wastePercent = Number.isFinite(enteredWaste) && enteredWaste >= 0 && enteredWaste <= 100 ? enteredWaste : 0;
    if (wastePercent > 0) {
      pushGroupedRow(rowsByKey, {
        key: stableRowKey('calculated', 'Pipe waste allowance', group.material, group.size, 'm'), kind: 'calculated', item: 'Pipe waste allowance',
        material: group.material, size: group.size, quantity: group.metres * wastePercent / 100, unit: 'm', basis: `Calculated at ${wastePercent}%`,
        formula: `${group.metres.toFixed(2)} m measured × ${wastePercent}% waste allowance.`, sources: group.refs,
      });
    }
    const clipSpacing = parseNumber(calculationInputs?.clipSpacingMm);
    if (Number.isFinite(clipSpacing) && clipSpacing > 0) {
      pushGroupedRow(rowsByKey, {
        key: stableRowKey('calculated', 'Pipe clips', group.material, group.size, 'ea'), kind: 'calculated', item: 'Pipe clips',
        material: group.material, size: `for ${group.size} pipe`, quantity: Math.ceil((group.metres * 1000) / clipSpacing), unit: 'ea',
        basis: `Calculated at ${clipSpacing.toLocaleString()} mm spacing`,
        formula: `Ceiling(${group.metres.toFixed(2)} m × 1,000 ÷ ${clipSpacing.toLocaleString()} mm).`, sources: group.refs,
      });
    }
  }

  const width = parseNumber(calculationInputs?.trenchWidthMm);
  const depth = parseNumber(calculationInputs?.trenchDepthMm);
  const beddingDepth = parseNumber(calculationInputs?.beddingDepthMm);
  const spoilExpansion = parseNumber(calculationInputs?.spoilExpansionPct);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(depth) && depth > 0) {
    const totalMetres = measurements.groups.reduce((sum, group) => sum + group.metres, 0);
    const excavated = totalMetres * (width / 1000) * (depth / 1000);
    const allRunRefs = measurements.groups.flatMap((group) => group.runIds.map((id) => ({ type: 'run', id, page: group.runPages?.find((entry) => entry.id === id)?.page ?? null, reference: `Run ${String(id).slice(-4)}` })));
    pushGroupedRow(rowsByKey, {
      key: stableRowKey('calculated', 'Trench excavation', 'Soil', `${width} × ${depth} mm`, 'm³'), kind: 'calculated', item: 'Trench excavation',
      material: 'Soil', size: `${width} × ${depth} mm`, quantity: excavated, unit: 'm³', basis: 'Calculated from entered trench dimensions',
      formula: `${totalMetres.toFixed(2)} m × ${(width / 1000).toFixed(3)} m × ${(depth / 1000).toFixed(3)} m.`, sources: allRunRefs,
    });
    if (Number.isFinite(beddingDepth) && beddingDepth > 0 && beddingDepth <= depth) {
      const beddingVolume = totalMetres * (width / 1000) * (beddingDepth / 1000);
      const beddingMaterial = String(calculationInputs?.beddingMaterial ?? '').trim();
      if (beddingMaterial) {
        pushGroupedRow(rowsByKey, {
          key: stableRowKey('calculated', 'Bedding', beddingMaterial, `${width} × ${beddingDepth} mm`, 'm³'), kind: 'calculated', item: 'Bedding',
          material: beddingMaterial, size: `${width} × ${beddingDepth} mm`, quantity: beddingVolume, unit: 'm³', basis: 'Calculated from entered width and bedding depth',
          formula: `${totalMetres.toFixed(2)} m × ${(width / 1000).toFixed(3)} m × ${(beddingDepth / 1000).toFixed(3)} m.`, sources: allRunRefs,
        });
      }
      const backfill = Math.max(0, excavated - beddingVolume);
      pushGroupedRow(rowsByKey, {
        key: stableRowKey('calculated', 'Backfill', 'Soil', `${width} × ${depth} mm`, 'm³'), kind: 'calculated', item: 'Backfill',
        material: 'Soil', size: `${width} × ${depth} mm`, quantity: backfill, unit: 'm³', basis: 'Calculated; excludes pipe displacement',
        formula: `${excavated.toFixed(3)} m³ excavation − ${beddingVolume.toFixed(3)} m³ bedding. Pipe displacement is not deducted.`, sources: allRunRefs,
      });
    }
    if (Number.isFinite(spoilExpansion) && spoilExpansion >= 0) {
      const spoil = excavated * (1 + spoilExpansion / 100);
      pushGroupedRow(rowsByKey, {
        key: stableRowKey('calculated', 'Spoil to cart', 'Soil', `${width} × ${depth} mm`, 'm³'), kind: 'calculated', item: 'Spoil to cart',
        material: 'Soil', size: `${width} × ${depth} mm`, quantity: spoil, unit: 'm³', basis: `Calculated with ${spoilExpansion}% expansion`,
        formula: `${excavated.toFixed(3)} m³ in-situ excavation × (1 + ${spoilExpansion}%).`, sources: allRunRefs,
      });
    }
  }
}

export function buildMaterialRows(state) {
  const rowsByKey = new Map();
  const marks = (state?.marks ?? []).filter((mark) => mark.status !== 'review' && mark.status !== 'rejected' && mark.status !== 'duplicate');
  for (const mark of marks) {
    const category = CATEGORIES[mark.category] ?? CATEGORIES.other;
    const item = String(mark.item || category.label).trim();
    const material = String(mark.material ?? '').trim() || 'Unspecified';
    const size = String(mark.size ?? '').trim() || 'Unspecified';
    const unit = mark.unit || 'ea';
    const key = stableRowKey('counted', item, material, size, unit);
    pushGroupedRow(rowsByKey, {
      key, kind: 'counted', item, material, size, quantity: Number(mark.quantity) > 0 ? Number(mark.quantity) : 1, unit,
      basis: 'Counted on plan', formula: 'Physical symbol mark; review the linked plan evidence.',
      sources: [sourceRef('mark', { ...mark, reference: mark.reference || mark.fixtureRef || `Mark ${String(mark.markNumber ?? '').padStart(2, '0')}` })],
    });
  }

  for (const entry of state?.manualMaterials ?? []) {
    const quantity = Number(entry.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const item = String(entry.item || 'Manual material').trim();
    const material = String(entry.material ?? '').trim() || 'Unspecified';
    const size = String(entry.size ?? '').trim() || 'Unspecified';
    const unit = String(entry.unit || 'ea').trim();
    const key = stableRowKey('manual', item, material, size, unit);
    pushGroupedRow(rowsByKey, {
      key, kind: 'manual', item, material, size, quantity,
      unit, basis: 'Manual entry', formula: entry.note || 'Entered by user.',
      sources: [sourceRef('manual', { ...entry, reference: entry.reference || entry.label || 'Manual entry' })],
    });
  }

  const measurements = measureRunGroups(state?.runs ?? [], state?.calibrations ?? {}, state?.pageDimensions ?? {});
  // Include run source page in each source reference. A run belongs to one page.
  const runById = new Map((state?.runs ?? []).map((run) => [run.id, run]));
  measurements.runsById = runById;
  getMeasuredRows(measurements, rowsByKey, { ...DEFAULT_CALCULATION_INPUTS, ...(state?.calculationInputs ?? {}) });
  const areaMeasurements = measureAreaGroups(state?.areas ?? [], state?.calibrations ?? {}, state?.pageDimensions ?? {});
  for (const group of areaMeasurements.groups) {
    const sources = group.pages.flatMap((pageGroup) => pageGroup.areaIds.map((id) => ({ type: 'area', id, page: pageGroup.page, reference: `Area ${String(id).slice(-4)}` })));
    pushGroupedRow(rowsByKey, {
      key: stableRowKey('measured', group.item, group.material, group.size, 'm²'), kind: 'measured', item: group.item,
      material: group.material, size: group.size, quantity: group.squareMetres, unit: 'm²', basis: 'Measured area',
      formula: 'Polygon area from the saved vertices and this sheet’s user-entered calibration.', sources,
    });
  }
  const rows = [...rowsByKey.values()]
    .filter((row) => Number.isFinite(row.quantity) && row.quantity >= 0)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.item.localeCompare(b.item) || a.material.localeCompare(b.material) || a.size.localeCompare(b.size));
  return rows.map((row) => ({ ...row, quantity: roundQuantity(row.quantity, row.unit) }));
}

export function roundQuantity(quantity, unit = '') {
  if (!Number.isFinite(Number(quantity))) return 0;
  const places = unit === 'ea' ? 0 : unit === 'm' ? 2 : unit === 'm³' || unit === 'm²' ? 3 : 2;
  const factor = 10 ** places;
  return Math.round((Number(quantity) + Number.EPSILON) * factor) / factor;
}

export function applyCalculatorRowsToTakeoff(existingTakeoff, rows, makeRowId = makeId) {
  const nonCalculatorRows = (existingTakeoff ?? []).filter((item) => item.source !== 'material-calculator');
  const previousLinked = new Map((existingTakeoff ?? [])
    .filter((item) => item.source === 'material-calculator')
    .map((item) => [item.linkedKey, item]));
  const nextLinked = rows.map((row) => {
    const prior = previousLinked.get(row.key);
    return {
      id: prior?.id ?? makeRowId('takeoff-calc'),
      source: 'material-calculator',
      linkedKey: row.key,
      item: row.item,
      material: row.material,
      size: row.size,
      quantity: row.quantity,
      unit: row.unit,
      basis: row.basis,
      sourceRefs: row.sources.map((source) => ({ ...source })),
      updatedAt: new Date().toISOString(),
    };
  });
  return [...nonCalculatorRows.map((item) => ({ ...item })), ...nextLinked];
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rowsToCsv(rows, pageLabels = {}) {
  const header = ['item', 'material', 'size', 'quantity', 'unit', 'source_page/reference', 'quantity_basis'];
  const lines = [header.map(csvEscape).join(',')];
  for (const row of rows ?? []) {
    const uniqueSources = new Set();
    const refs = (row.sources ?? []).map((source) => {
      const page = source.page ? (pageLabels[source.page] || `P${source.page}`) : 'No page';
      const ref = source.reference || source.label || source.id || source.type;
      const label = `${page} ${ref}`.trim();
      if (uniqueSources.has(label)) return null;
      uniqueSources.add(label);
      return label;
    }).filter(Boolean);
    if (!refs.length) refs.push('No plan reference');
    lines.push([
      row.item, row.material, row.size, row.quantity, row.unit,
      refs.join('; '), row.basis || row.kind || '',
    ].map(csvEscape).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

function imageGray(data, index) {
  return (data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
}

function samplePatch(imageData, x, y, width, height, gridW, gridH) {
  const values = new Float32Array(gridW * gridH);
  for (let gy = 0; gy < gridH; gy += 1) {
    for (let gx = 0; gx < gridW; gx += 1) {
      const sx = Math.min(imageData.width - 1, Math.max(0, Math.floor(x + ((gx + 0.5) / gridW) * width)));
      const sy = Math.min(imageData.height - 1, Math.max(0, Math.floor(y + ((gy + 0.5) / gridH) * height)));
      values[gy * gridW + gx] = imageGray(imageData.data, (sy * imageData.width + sx) * 4);
    }
  }
  return values;
}

function normalized(values) {
  let mean = 0;
  for (const value of values) mean += value;
  mean /= values.length;
  let variance = 0;
  const centered = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    centered[index] = values[index] - mean;
    variance += centered[index] * centered[index];
  }
  return { centered, norm: Math.sqrt(variance) };
}

/** Basic same-scale luminance template matching. Results remain review candidates. */
export function matchTemplate(source, template, { threshold = 0.86, maxMatches = 150, stride = 3 } = {}) {
  if (!source || !template || !source.data || !template.data) return [];
  if (template.width < 14 || template.height < 14 || source.width < template.width || source.height < template.height) return [];
  const gridW = 18;
  const gridH = Math.max(10, Math.round(gridW * template.height / template.width));
  const templateValues = samplePatch(template, 0, 0, template.width, template.height, gridW, gridH);
  const target = normalized(templateValues);
  if (target.norm < 30) return [];
  const width = template.width;
  const height = template.height;
  const step = Math.max(2, Math.floor(stride));
  const candidates = [];
  for (let y = 0; y <= source.height - height; y += step) {
    for (let x = 0; x <= source.width - width; x += step) {
      const values = samplePatch(source, x, y, width, height, gridW, gridH);
      const patch = normalized(values);
      if (patch.norm < 25) continue;
      let dot = 0;
      for (let index = 0; index < patch.centered.length; index += 1) dot += patch.centered[index] * target.centered[index];
      const score = dot / (patch.norm * target.norm);
      if (score >= threshold) candidates.push({ x, y, width, height, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const selected = [];
  const overlap = (a, b) => {
    const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return (ix * iy) / (width * height);
  };
  for (const candidate of candidates) {
    if (selected.some((existing) => overlap(existing, candidate) > 0.28)) continue;
    selected.push(candidate);
    if (selected.length >= maxMatches) break;
  }
  return selected;
}

export function canvasRectToNormalised(rect, canvas) {
  const bounds = canvas.getBoundingClientRect();
  const scaleX = canvas.width / bounds.width;
  const scaleY = canvas.height / bounds.height;
  return {
    x: Math.max(0, Math.min(1, ((rect.x - bounds.left) * scaleX) / canvas.width)),
    y: Math.max(0, Math.min(1, ((rect.y - bounds.top) * scaleY) / canvas.height)),
    width: Math.max(0, Math.min(1, (rect.width * scaleX) / canvas.width)),
    height: Math.max(0, Math.min(1, (rect.height * scaleY) / canvas.height)),
  };
}

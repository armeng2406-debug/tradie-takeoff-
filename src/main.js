import './styles.css';
import {
  CATEGORIES,
  DEFAULT_CALCULATION_INPUTS,
  applyCalculatorRowsToTakeoff,
  buildMaterialRows,
  distance,
  makeId,
  matchTemplate,
  measureRunGroups,
  measureAreaGroups,
  normalizedToDisplay,
  parseNumber,
  removeDuplicateCandidates,
  rowsToCsv,
} from './core.js';
import {
  WorkspaceStore,
  createDefaultState,
  loadDocumentBytes,
  saveDocumentBytes,
  slugify,
  workspaceKey,
} from './storage.js';
import { SAMPLE_FIXTURES, SAMPLE_HEIGHT, SAMPLE_PAGES, SAMPLE_REFERENCE_COUNTS, SAMPLE_WIDTH } from './samplePlan.js';
import { loadPdfDocument, renderPdfPage, renderPdfPageToImage } from './pdfViewer.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const store = new WorkspaceStore();
const cachedLast = store.loadLast();
let state = cachedLast ? migrateState(cachedLast) : createDefaultState();
let pdfDocument = null;
let pdfBytes = null;
let activeTool = 'select';
let currentZoom = 1;
let displayWidth = 0;
let displayHeight = 0;
let renderSequence = 0;
let saveTimer = null;
let saveState = cachedLast ? 'saved' : 'saved';
let selectedObject = null;
let expandedRowKey = null;
let activeDrag = null;
let dragSelectionRect = null;
let ignoreNextClick = false;
let draftCalibrationPoints = [];
let draftRunPoints = [];
let draftAreaPoints = [];
let pendingTemplate = null;
let pendingSearchConfig = null;
let pendingSearchArea = null;
let currentSearchBatchId = null;
let focusTarget = null;
let lastSavedAt = cachedLast?.updatedAt ?? null;
let pendingStorageWarning = '';
const imageCache = new Map();
const stage = $('#planStage');
const planCanvas = $('#planCanvas');
const overlay = $('#planOverlay');
const viewport = $('#planViewport');
const appDialog = $('#appDialog');

function migrateState(source) {
  const defaults = createDefaultState();
  const saved = source && typeof source === 'object' ? source : {};
  return {
    ...defaults,
    ...saved,
    project: { ...defaults.project, ...(saved.project ?? {}) },
    document: { ...defaults.document, ...(saved.document ?? {}) },
    pageDimensions: saved.pageDimensions ?? defaults.pageDimensions,
    marks: Array.isArray(saved.marks) ? saved.marks : [],
    runs: Array.isArray(saved.runs) ? saved.runs : [],
    areas: Array.isArray(saved.areas) ? saved.areas : [],
    calibrations: saved.calibrations ?? {},
    calculationInputs: { ...DEFAULT_CALCULATION_INPUTS, ...(saved.calculationInputs ?? {}) },
    manualMaterials: Array.isArray(saved.manualMaterials) ? saved.manualMaterials : [],
    takeoff: Array.isArray(saved.takeoff) ? saved.takeoff : [],
    currentPage: Number(saved.currentPage) || 1,
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function escapeSvg(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function currentPageCount() {
  return Math.max(1, Number(state.document.pageCount) || 1);
}

function currentPageLabel(page = state.currentPage) {
  const label = state.sheetLabels?.[page];
  return label || `P${String(page).padStart(2, '0')}`;
}

function displayQuantity(quantity, unit) {
  if (unit === 'ea') return `${Math.round(quantity).toLocaleString()}`;
  const decimals = unit === 'm' ? 2 : 3;
  return Number(quantity).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function setSaveState(next, message) {
  saveState = next;
  const element = $('#saveState');
  element.classList.toggle('is-saved', next === 'saved');
  element.classList.toggle('is-saving', next === 'saving' || next === 'unsaved');
  element.classList.toggle('is-failed', next === 'failed');
  const symbol = $('.state-symbol', element);
  symbol.textContent = next === 'saved' ? '✓' : next === 'failed' ? '!' : '…';
  $('#saveStateText').textContent = message || ({
    saved: 'Saved on this device', unsaved: 'Unsaved changes', saving: 'Saving…', failed: 'Save failed',
  })[next];
  $('#lastSavedText').textContent = lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Local draft';
}

function toast(message, kind = 'success', duration = 4000) {
  const region = $('#toastRegion');
  const element = document.createElement('div');
  element.className = `toast ${kind === 'success' ? '' : kind}`.trim();
  const icon = kind === 'error' ? '!' : kind === 'warning' ? '!' : '✓';
  element.innerHTML = `<span class="toast-icon" aria-hidden="true">${icon}</span><span>${escapeHtml(message)}</span>`;
  region.append(element);
  window.setTimeout(() => element.remove(), duration);
}

function saveNow({ silent = false } = {}) {
  window.clearTimeout(saveTimer);
  setSaveState('saving');
  try {
    const saved = store.save(state);
    state = saved.state;
    lastSavedAt = state.updatedAt;
    setSaveState('saved');
    renderHeader();
    return true;
  } catch (error) {
    setSaveState('failed', 'Save failed · retry');
    if (!silent) toast(`Could not save. Your changes are still open; select Save to retry. ${error.message}`, 'error', 7000);
    return false;
  }
}

function markDirty({ immediate = false } = {}) {
  state.updatedAt = new Date().toISOString();
  setSaveState('unsaved');
  window.clearTimeout(saveTimer);
  if (immediate) return saveNow({ silent: true });
  saveTimer = window.setTimeout(() => saveNow({ silent: true }), 550);
}

function renderHeader() {
  const projectInput = $('#projectName');
  if (document.activeElement !== projectInput) projectInput.value = state.project.name || 'Untitled project';
  $('#documentName').textContent = state.document.name || 'Untitled plan';
  const suffix = state.document.kind === 'sample' ? 'Sample drawing · 2 sheets · local-only workspace' : `${state.document.pageCount} sheets · PDF kept in this browser`;
  $('#documentSubtext').textContent = suffix;
  const currentPage = Math.min(Math.max(1, Number(state.currentPage) || 1), currentPageCount());
  $('#pageIndicator').innerHTML = `Sheet <strong>${currentPage}</strong> of <strong>${currentPageCount()}</strong>`;
  $('#prevPageButton').disabled = currentPage <= 1;
  $('#nextPageButton').disabled = currentPage >= currentPageCount();
  $('#prevPageButton').style.opacity = currentPage <= 1 ? '.45' : '1';
  $('#nextPageButton').style.opacity = currentPage >= currentPageCount() ? '.45' : '1';
  $('#zoomLabel').textContent = `${Math.round(currentZoom * 100)}%`;
  const calibration = state.calibrations?.[currentPage] ?? state.calibrations?.[String(currentPage)];
  const scaleNote = $('#pageScaleNote');
  scaleNote.classList.toggle('has-scale', Boolean(calibration?.mmPerPaperUnit));
  scaleNote.innerHTML = calibration?.mmPerPaperUnit
    ? `<span class="scale-dot"></span> Calibrated · ${(Number(calibration.referenceMm) || 0).toLocaleString()} mm reference`
    : '<span class="scale-dot"></span> No scale set on this sheet';
  $('#mobileTotalCount').textContent = String(state.marks.filter((mark) => mark.status !== 'review' && mark.status !== 'duplicate' && mark.status !== 'rejected').reduce((sum, mark) => sum + (Number(mark.quantity) || 1), 0));
  setSaveState(saveState);
  $('#samplePlanButton').hidden = state.document.kind === 'sample';
}

function renderCalculationFields() {
  const inputMap = {
    pipeWastePct: '#pipeWasteInput', clipSpacingMm: '#clipSpacingInput', trenchWidthMm: '#trenchWidthInput',
    trenchDepthMm: '#trenchDepthInput', beddingDepthMm: '#beddingDepthInput', spoilExpansionPct: '#spoilExpansionInput',
    beddingMaterial: '#beddingMaterialInput',
  };
  for (const [key, selector] of Object.entries(inputMap)) {
    const input = $(selector);
    if (document.activeElement !== input) input.value = state.calculationInputs?.[key] ?? DEFAULT_CALCULATION_INPUTS[key] ?? '';
  }
}

function renderMaterialPanel() {
  const rows = buildMaterialRows(state);
  const counted = state.marks.filter((mark) => mark.status !== 'review' && mark.status !== 'rejected' && mark.status !== 'duplicate')
    .reduce((sum, mark) => sum + (Number(mark.quantity) || 1), 0);
  const measuredLength = rows.filter((row) => row.kind === 'measured' && row.unit === 'm').reduce((sum, row) => sum + Number(row.quantity), 0);
  const measuredArea = rows.filter((row) => row.kind === 'measured' && row.unit === 'm²').reduce((sum, row) => sum + Number(row.quantity), 0);
  const reviewCount = state.marks.filter((mark) => mark.status === 'review').length;
  $('#countedStat').textContent = counted.toLocaleString();
  $('#measuredStat').textContent = measuredArea > 0 ? `${measuredLength.toFixed(2)} m · ${measuredArea.toFixed(2)} m²` : `${measuredLength.toFixed(2)} m`;
  $('#reviewStat').textContent = String(reviewCount);
  $('#mobileTotalCount').textContent = String(counted);
  const reviewBanner = $('#reviewBanner');
  reviewBanner.hidden = reviewCount === 0;
  $('#reviewBannerCount').textContent = String(reviewCount);
  $('#emptyMaterials').classList.toggle('is-visible', rows.length === 0);
  const list = $('#materialsList');
  list.innerHTML = rows.map((row) => {
    const rowClass = row.kind === 'measured' ? 'measured' : row.kind === 'calculated' ? 'calculated' : row.kind === 'manual' ? 'manual' : 'counted';
    const symbol = row.kind === 'measured' ? (row.unit === 'm²' ? '▱' : '↗') : row.kind === 'calculated' ? 'ƒ' : row.kind === 'manual' ? 'M' : categoryCode(row.item);
    const meta = `${escapeHtml(row.material)} · ${escapeHtml(row.size)} · ${escapeHtml(row.basis || row.kind)}`;
    const refs = row.sources ?? [];
    const pageSummary = [...new Set(refs.map((ref) => ref.page).filter(Boolean))].map((page) => currentPageLabel(page)).join(', ');
    const sourceTypeText = row.kind === 'counted' ? 'COUNTED' : row.kind === 'measured' ? 'MEASURED' : row.kind === 'manual' ? 'MANUAL ENTRY' : 'CALCULATED';
    const detailFormula = row.formula ? `<div class="details-source-note">${escapeHtml(row.formula)}</div>` : '';
    const markRefs = refs.filter((ref) => ref.type === 'mark');
    const groupEdit = markRefs.length > 1 ? `<button class="text-button edit-group-button" type="button" data-edit-group="${escapeHtml(row.key)}">Edit group</button>` : '';
    const sourceLinks = refs.length ? refs.map((source) => {
      const sourceText = source.reference || source.label || (source.type === 'mark' ? 'Counted mark' : source.type === 'run' ? 'Measured run' : 'Manual entry');
      const pageText = source.page ? currentPageLabel(source.page) : 'No sheet';
      const canFocus = source.page && (source.type === 'mark' || source.type === 'run' || source.type === 'area' || source.type === 'manual');
      const removeButton = source.type === 'mark' || source.type === 'run' || source.type === 'area' || source.type === 'manual'
        ? `<button class="source-delete" type="button" data-remove-source-type="${escapeHtml(source.type)}" data-remove-source-id="${escapeHtml(source.id)}" aria-label="Remove ${escapeHtml(sourceText)}" title="Remove">×</button>` : '';
      return `<div class="source-row"><button class="source-link" type="button" ${canFocus ? `data-source-type="${escapeHtml(source.type)}" data-source-id="${escapeHtml(source.id)}" data-source-page="${escapeHtml(source.page)}"` : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h4"/></svg>
        <span>${escapeHtml(sourceText)}</span><span class="source-ref">${escapeHtml(pageText)}</span></button>${removeButton}</div>`;
    }).join('') : '<span class="source-ref">No source linked</span>';
    const canEditGroup = markRefs.length > 1;
    return `<article class="material-row ${expandedRowKey === row.key ? 'is-expanded' : ''}" data-row-key="${escapeHtml(row.key)}">
      <button class="material-row-button" type="button" data-material-row="${escapeHtml(row.key)}" aria-expanded="${expandedRowKey === row.key}">
        <span class="row-symbol ${rowClass}" aria-hidden="true">${escapeHtml(symbol)}</span>
        <span class="row-description"><span class="row-title">${escapeHtml(row.item)}</span><span class="row-meta">${meta}</span></span>
        <span class="row-quantity"><strong>${displayQuantity(row.quantity, row.unit)}</strong><span>${escapeHtml(row.unit)}</span></span><span class="row-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="material-row-details">
        <div class="row-source-summary"><span class="source-badge ${row.kind}">${sourceTypeText} · ${refs.length} source${refs.length === 1 ? '' : 's'}${pageSummary ? ` · ${escapeHtml(pageSummary)}` : ''}</span>${canEditGroup ? groupEdit : ''}</div>
        ${detailFormula}<div class="source-list">${sourceLinks}</div>
      </div>
    </article>`;
  }).join('');

  const linked = state.takeoff.filter((item) => item.source === 'material-calculator');
  const preserved = state.takeoff.filter((item) => item.source !== 'material-calculator');
  $('#takeoffSummary').innerHTML = `<span><strong>${linked.length}</strong> calculator-linked row${linked.length === 1 ? '' : 's'}</span><span><strong>${preserved.length}</strong> other row${preserved.length === 1 ? '' : 's'} preserved</span>`;
  const applyButton = $('#applyToTakeoffButton');
  applyButton.disabled = rows.length === 0;
  applyButton.querySelector('span').textContent = linked.length ? `Update ${linked.length} linked row${linked.length === 1 ? '' : 's'}` : 'Add to takeoff';
  renderCalculationFields();
  const inputs = state.calculationInputs ?? {};
  const validationMessages = [];
  const wasteText = String(inputs.pipeWastePct ?? '').trim();
  const waste = parseNumber(wasteText);
  if (wasteText && (!Number.isFinite(waste) || waste < 0 || waste > 100)) validationMessages.push('Pipe waste must be between 0% and 100%; its calculated row is omitted until corrected.');
  const clipText = String(inputs.clipSpacingMm ?? '').trim();
  const clipSpacing = parseNumber(clipText);
  if (clipText && (!Number.isFinite(clipSpacing) || clipSpacing <= 0)) validationMessages.push('Clip spacing must be greater than 0 mm; clip quantity is omitted until corrected.');
  const widthText = String(inputs.trenchWidthMm ?? '').trim();
  const depthText = String(inputs.trenchDepthMm ?? '').trim();
  if (Boolean(widthText) !== Boolean(depthText)) validationMessages.push('Enter both trench width and depth before calculating excavation.');
  const trenchDepth = parseNumber(depthText);
  const beddingText = String(inputs.beddingDepthMm ?? '').trim();
  const beddingDepth = parseNumber(beddingText);
  if (beddingText && Number.isFinite(trenchDepth) && beddingDepth > trenchDepth) validationMessages.push('Bedding depth cannot exceed trench depth; bedding and backfill rows are omitted until corrected.');
  const spoilText = String(inputs.spoilExpansionPct ?? '').trim();
  const spoilExpansion = parseNumber(spoilText);
  if (spoilText && (!Number.isFinite(spoilExpansion) || spoilExpansion < 0)) validationMessages.push('Spoil expansion must be 0% or more; spoil quantity is omitted until corrected.');
  const validation = $('#calculationValidation');
  validation.hidden = validationMessages.length === 0;
  validation.textContent = validationMessages.join(' ');
  renderSelectedItem();
}

function categoryCode(item) {
  const lower = String(item ?? '').toLocaleLowerCase();
  if (lower.includes('toilet') || lower.includes('wc')) return 'W';
  if (lower.includes('basin')) return 'B';
  if (lower.includes('floor waste')) return 'F';
  if (lower.includes('pipe')) return 'P';
  return 'M';
}

function categorySelectOptions(selected) {
  return Object.entries(CATEGORIES).map(([key, value]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${escapeHtml(value.label)}</option>`).join('');
}

function renderSelectedItem() {
  const section = $('#selectedItemSection');
  const content = $('#selectedItemContent');
  if (!selectedObject) {
    section.hidden = true;
    return;
  }
  const object = selectedObject.type === 'mark' ? state.marks.find((item) => item.id === selectedObject.id)
    : selectedObject.type === 'run' ? state.runs.find((item) => item.id === selectedObject.id)
      : selectedObject.type === 'area' ? state.areas.find((item) => item.id === selectedObject.id)
        : state.manualMaterials.find((item) => item.id === selectedObject.id);
  if (!object) {
    selectedObject = null;
    section.hidden = true;
    return;
  }
  section.hidden = false;
  if (selectedObject.type === 'mark') {
    const candidate = object.status === 'review';
    const repeated = object.possibleRepeatOf || object.crossPageNeedsReview ? `<div class="dialog-warning"><span>!</span><span>${object.possibleRepeatPage ? `Similar candidate at ${escapeHtml(currentPageLabel(object.possibleRepeatPage))}. ` : 'This candidate came from an all-pages search. '}It may be the same physical fixture shown in a repeated view. Choose whether to keep both or treat this as a duplicate.</span></div>` : '';
    $('#selectedItemHeading').textContent = candidate ? 'Review symbol candidate' : `Mark ${String(object.markNumber || '').padStart(2, '0')}`;
    content.innerHTML = `<div class="selected-item-card">
      <div class="selected-title"><strong>${candidate ? 'Needs review · not yet counted' : 'Counted physical item'}</strong><span>${escapeHtml(currentPageLabel(object.page))}${object.reference ? ` · ${escapeHtml(object.reference)}` : ''}</span></div>
      ${repeated}
      <div class="edit-grid">
        <label>Category<select id="selectedCategoryInput">${categorySelectOptions(object.category)}</select></label>
        <label>Material<input id="selectedMaterialInput" value="${escapeHtml(object.material ?? '')}" placeholder="Enter or leave unspecified"></label>
        <label>Size<input id="selectedSizeInput" value="${escapeHtml(object.size ?? '')}" placeholder="Enter or leave unspecified"></label>
        <label>Quantity<input id="selectedQuantityInput" type="number" min="1" step="1" value="${Number(object.quantity) || 1}"></label>
      </div>
      <div class="details-source-note">${object.origin === 'local-template' ? `Local visual match · ${Math.round((Number(object.confidence) || 0) * 100)}% similarity. This score is not a semantic fixture classification.` : object.origin === 'sample-reference' ? 'Matched against the sample plan’s manually checked physical-symbol index; notes and schedule entries are excluded.' : 'Manual plan mark. Counted symbols do not require a drawing scale.'}</div>
      <div class="selected-actions">
        <button type="button" data-edit-save="mark">Save correction</button>
        ${candidate ? '<button type="button" data-review-accept="' + escapeHtml(object.id) + '">Accept match</button>' : ''}
        <button type="button" class="danger-action" data-delete-selected="mark">${candidate ? 'Remove match' : 'Remove mark'}</button>
      </div>
    </div>`;
  } else if (selectedObject.type === 'run') {
    const calibration = state.calibrations?.[object.page];
    const length = getSingleRunLength(object);
    $('#selectedItemHeading').textContent = `Run ${String(state.runs.indexOf(object) + 1).padStart(2, '0')}`;
    content.innerHTML = `<div class="selected-item-card">
      <div class="selected-title"><strong>${length === null ? 'Length not calculated' : `${length.toFixed(2)} m measured`}</strong><span>${escapeHtml(currentPageLabel(object.page))}</span></div>
      <div class="edit-grid">
        <label>Material<input id="selectedRunMaterialInput" value="${escapeHtml(object.material ?? '')}" placeholder="e.g. PVC"></label>
        <label>Size / diameter<input id="selectedRunSizeInput" value="${escapeHtml(object.size ?? '')}" placeholder="e.g. 100 mm"></label>
      </div>
      <div class="details-source-note">${calibration ? 'Measured from this sheet’s saved calibration.' : 'This run is saved, but its length is excluded until this page is calibrated.'} Shared route segments are counted once in the material summary.</div>
      <div class="selected-actions"><button type="button" data-edit-save="run">Save correction</button><button type="button" class="danger-action" data-delete-selected="run">Remove run</button></div>
    </div>`;
  } else if (selectedObject.type === 'area') {
    const calibration = state.calibrations?.[object.page];
    const area = getSingleArea(object);
    $('#selectedItemHeading').textContent = `Area ${String(state.areas.indexOf(object) + 1).padStart(2, '0')}`;
    content.innerHTML = `<div class="selected-item-card">
      <div class="selected-title"><strong>${area === null ? 'Area not calculated' : `${area.toFixed(3)} m² measured`}</strong><span>${escapeHtml(currentPageLabel(object.page))}</span></div>
      <div class="edit-grid">
        <label>Item<input id="selectedAreaItemInput" value="${escapeHtml(object.item ?? '')}" placeholder="Measured area"></label>
        <label>Material<input id="selectedAreaMaterialInput" value="${escapeHtml(object.material ?? '')}" placeholder="Enter if specified"></label>
        <label>Size / depth<input id="selectedAreaSizeInput" value="${escapeHtml(object.size ?? '')}" placeholder="Enter if specified"></label>
        <label>Unit<input value="m² · fixed" disabled></label>
      </div>
      <div class="details-source-note">${calibration ? 'Calculated from the saved polygon and this page’s calibration.' : 'Polygon is saved, but this area is excluded until the page is calibrated.'}</div>
      <div class="selected-actions"><button type="button" data-edit-save="area">Save correction</button><button type="button" class="danger-action" data-delete-selected="area">Remove area</button></div>
    </div>`;
  } else {
    $('#selectedItemHeading').textContent = 'Manual material entry';
    content.innerHTML = `<div class="selected-item-card">
      <div class="selected-title"><strong>${escapeHtml(object.item)}</strong><span>${escapeHtml(currentPageLabel(object.page))} · manual</span></div>
      <div class="edit-grid">
        <label>Item<input id="selectedManualItemInput" value="${escapeHtml(object.item ?? '')}"></label>
        <label>Material<input id="selectedManualMaterialInput" value="${escapeHtml(object.material ?? '')}"></label>
        <label>Size<input id="selectedManualSizeInput" value="${escapeHtml(object.size ?? '')}"></label>
        <label>Quantity<input id="selectedManualQuantityInput" type="number" min="0.01" step="any" value="${Number(object.quantity) || 1}"></label>
      </div>
      <div class="selected-actions"><button type="button" data-edit-save="manual">Save correction</button><button type="button" class="danger-action" data-delete-selected="manual">Remove entry</button></div>
    </div>`;
  }
}

function setTool(next) {
  const previousTool = activeTool;
  activeTool = activeTool === next ? 'select' : next;
  if (activeTool === 'measure' && previousTool !== 'measure') draftRunPoints = [];
  if (activeTool === 'area' && previousTool !== 'area') draftAreaPoints = [];
  draftCalibrationPoints = [];
  if (activeTool !== 'measure') draftRunPoints = [];
  if (activeTool !== 'area') draftAreaPoints = [];
  $$('.tool-button[data-tool]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.tool === activeTool)));
  $('#finishRunButton').hidden = activeTool !== 'measure' || draftRunPoints.length < 2;
  $('#finishAreaButton').hidden = activeTool !== 'area' || draftAreaPoints.length < 3;
  stage.dataset.tool = activeTool;
  const hint = $('#canvasHint');
  hint.classList.remove('is-active', 'is-warning');
  const content = {
    select: 'Select a mark or run to inspect it. Use the drawing tools to count or trace.',
    count: `Count mode · click each physical ${CATEGORIES[$('#categorySelect').value]?.label.toLocaleLowerCase() || 'fitting'} symbol. No scale required.`,
    find: 'Find symbols · drag tightly around one physical example symbol; select pages and search area next.',
    calibrate: 'Calibrate this sheet · click two points with a known distance, then enter that reference.',
    measure: 'Measure run · click route vertices, then select Finish run. An unscaled run is saved but not priced as a length.',
    area: 'Measure area · click at least three boundary points, then Finish area. A valid calibration is required for m².',
    'search-area': 'Search area · drag a rectangle on the current sheet. The same region will be checked on each selected page.',
  };
  hint.textContent = content[activeTool] || content.select;
  if (activeTool !== 'select') hint.classList.add('is-active');
  if ((activeTool === 'measure' || activeTool === 'area' || activeTool === 'calibrate') && !state.calibrations?.[state.currentPage]) hint.classList.add('is-warning');
  renderOverlay();
}

function getPageIntrinsicDimensions(page = state.currentPage) {
  return state.pageDimensions?.[page] ?? state.pageDimensions?.[String(page)] ?? { width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT };
}

function getFitWidth() {
  const horizontalPadding = window.innerWidth <= 850 ? 24 : 48;
  return Math.max(180, (viewport.clientWidth || 800) - horizontalPadding) * currentZoom;
}

function getCachedSvgImage(page) {
  if (imageCache.has(page)) return imageCache.get(page);
  const image = new Image();
  const load = new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not render the built-in sample plan.'));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SAMPLE_PAGES[page - 1])}`;
  const entry = { image, load };
  imageCache.set(page, entry);
  return entry;
}

async function renderPlan() {
  const token = ++renderSequence;
  const page = Math.min(Math.max(1, Number(state.currentPage) || 1), currentPageCount());
  state.currentPage = page;
  const fitWidth = getFitWidth();
  $('#stageEmpty').hidden = true;
  try {
    if (state.document.kind === 'pdf') {
      if (!pdfDocument) {
        $('#stageEmpty').hidden = false;
        displayWidth = Math.max(300, Math.min(fitWidth, 650));
        displayHeight = displayWidth * 0.68;
        stage.style.width = `${displayWidth}px`;
        stage.style.height = `${displayHeight}px`;
        planCanvas.style.display = 'none';
        overlay.style.display = 'none';
        renderHeader();
        return;
      }
      planCanvas.style.display = 'block';
      overlay.style.display = 'block';
      const dimensions = await renderPdfPage(pdfDocument, page, planCanvas, fitWidth);
      if (token !== renderSequence) return;
      displayWidth = dimensions.displayWidth;
      displayHeight = dimensions.displayHeight;
      stage.style.width = `${displayWidth}px`;
      stage.style.height = `${displayHeight}px`;
      state.pageDimensions[page] = { width: dimensions.width, height: dimensions.height };
    } else {
      planCanvas.style.display = 'block';
      overlay.style.display = 'block';
      const displayScale = fitWidth / SAMPLE_WIDTH;
      displayWidth = SAMPLE_WIDTH * displayScale;
      displayHeight = SAMPLE_HEIGHT * displayScale;
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      planCanvas.width = Math.ceil(displayWidth * outputScale);
      planCanvas.height = Math.ceil(displayHeight * outputScale);
      planCanvas.style.width = `${displayWidth}px`;
      planCanvas.style.height = `${displayHeight}px`;
      stage.style.width = `${displayWidth}px`;
      stage.style.height = `${displayHeight}px`;
      const { image, load } = getCachedSvgImage(page);
      await load;
      if (token !== renderSequence) return;
      const context = planCanvas.getContext('2d', { alpha: false });
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = '#fff';
      context.fillRect(0, 0, planCanvas.width, planCanvas.height);
      context.drawImage(image, 0, 0, planCanvas.width, planCanvas.height);
    }
    overlay.setAttribute('viewBox', `0 0 ${displayWidth} ${displayHeight}`);
    overlay.setAttribute('preserveAspectRatio', 'none');
    renderOverlay();
    renderHeader();
    if (focusTarget) scrollToFocusTarget(focusTarget);
  } catch (error) {
    console.error(error);
    toast(`Plan could not be rendered. ${error.message}`, 'error');
  }
}

function renderOverlay() {
  if (!displayWidth || !displayHeight || overlay.style.display === 'none') return;
  const width = displayWidth;
  const height = displayHeight;
  const page = state.currentPage;
  const accepted = state.marks.filter((mark) => mark.status !== 'review' && mark.status !== 'duplicate' && mark.status !== 'rejected');
  const acceptedIndex = new Map(accepted.map((mark, index) => [mark.id, mark.markNumber || index + 1]));
  const chunks = [];
  for (const area of (state.areas ?? []).filter((item) => item.page === page)) {
    if (!Array.isArray(area.points) || area.points.length < 3) continue;
    const displayPoints = area.points.map((point) => normalizedToDisplay(point, width, height));
    const coordinates = displayPoints.map((point) => `${point.x},${point.y}`).join(' ');
    const selected = selectedObject?.type === 'area' && selectedObject.id === area.id;
    const center = displayPoints.reduce((result, point) => ({ x: result.x + point.x / displayPoints.length, y: result.y + point.y / displayPoints.length }), { x: 0, y: 0 });
    const areaNumber = String((state.areas.indexOf(area) + 1)).padStart(2, '0');
    chunks.push(`<polygon class="area-polygon ${selected ? 'area-polygon-selected' : ''}" points="${coordinates}" data-area-id="${escapeSvg(area.id)}" tabindex="0" role="button" aria-label="Measured area ${areaNumber} · ${escapeSvg(area.item || 'unnamed area')}"/>`);
    chunks.push(`<g transform="translate(${center.x} ${center.y})" aria-hidden="true"><rect class="area-number" x="-14" y="-10" width="28" height="20" rx="5"/><text class="area-number-text" y=".5">A${areaNumber}</text></g>`);
  }
  if (draftAreaPoints.length) {
    const displayPoints = draftAreaPoints.map((point) => normalizedToDisplay(point, width, height));
    const coordinates = displayPoints.map((point) => `${point.x},${point.y}`).join(' ');
    chunks.push(`<polygon class="area-polygon area-polygon-draft" points="${coordinates}"/>`);
    displayPoints.forEach((point) => chunks.push(`<circle class="area-vertex" cx="${point.x}" cy="${point.y}" r="4"/>`));
  }
  for (const run of state.runs.filter((item) => item.page === page)) {
    if (!Array.isArray(run.points) || run.points.length < 2) continue;
    const points = run.points.map((point) => { const display = normalizedToDisplay(point, width, height); return `${display.x},${display.y}`; }).join(' ');
    const selected = selectedObject?.type === 'run' && selectedObject.id === run.id;
    const runNumber = String(state.runs.indexOf(run) + 1).padStart(2, '0');
    chunks.push(`<polyline class="run-line ${selected ? 'run-line-selected' : ''}" points="${points}" data-run-id="${escapeSvg(run.id)}" tabindex="0" role="button" aria-label="Measured run ${runNumber}"/>`);
    run.points.forEach((point) => { const display = normalizedToDisplay(point, width, height); chunks.push(`<circle class="run-vertex" cx="${display.x}" cy="${display.y}" r="4"/>`); });
    const first = normalizedToDisplay(run.points[0], width, height);
    chunks.push(`<g transform="translate(${first.x + 11} ${first.y - 12})" aria-hidden="true"><circle class="run-number" r="10"/><text class="run-number-text" y=".5">${runNumber}</text></g>`);
  }
  if (draftRunPoints.length) {
    const points = draftRunPoints.map((point) => { const display = normalizedToDisplay(point, width, height); return `${display.x},${display.y}`; }).join(' ');
    chunks.push(`<polyline class="run-line" points="${points}" stroke-dasharray="6 4"/>`);
    draftRunPoints.forEach((point) => { const display = normalizedToDisplay(point, width, height); chunks.push(`<circle class="run-vertex" cx="${display.x}" cy="${display.y}" r="5"/>`); });
  }
  const calibration = state.calibrations?.[page] ?? state.calibrations?.[String(page)];
  if (calibration?.points?.length === 2) {
    const [a, b] = calibration.points;
    const start = normalizedToDisplay(a, width, height);
    const end = normalizedToDisplay(b, width, height);
    chunks.push(`<line class="calibration-line" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}"/>`);
  }
  if (draftCalibrationPoints.length === 1) {
    const point = draftCalibrationPoints[0];
    chunks.push(`<circle class="run-vertex" cx="${point.x * width}" cy="${point.y * height}" r="6"/>`);
  }
  for (const mark of state.marks.filter((item) => item.page === page)) {
    const { x, y } = normalizedToDisplay(mark, width, height);
    const category = mark.category || 'other';
    const shape = category === 'toilet'
      ? `<rect x="-14" y="-14" width="28" height="28" rx="5" class="mark-ring mark-shape-toilet"/>`
      : category === 'basin'
        ? `<circle r="14" class="mark-ring mark-shape-basin"/>`
        : category === 'floor-waste'
          ? `<path d="M0-17 17 0 0 17-17 0Z" class="mark-ring mark-shape-floor-waste"/>`
          : category === 'shower'
            ? `<path d="M0-16 14-8 14 8 0 16-14 8-14-8Z" class="mark-ring mark-shape-shower"/>`
            : `<path d="M-14-9 0-17 14-9 14 8 0 17-14 8Z" class="mark-ring mark-shape-other"/>`;
    const candidate = mark.status === 'review';
    const selected = selectedObject?.type === 'mark' && selectedObject.id === mark.id;
    const number = candidate ? '?' : String(acceptedIndex.get(mark.id) ?? mark.markNumber ?? '?');
    const code = CATEGORIES[category]?.short || '+';
    const title = `${candidate ? 'Review candidate' : 'Mark'} ${number} · ${CATEGORIES[category]?.label || 'Fitting'} · ${currentPageLabel(page)}${mark.reference ? ` · ${mark.reference}` : ''}`;
    chunks.push(`<g class="overlay-mark ${candidate ? 'mark-needs-review' : ''} ${selected ? 'mark-selected' : ''}" transform="translate(${x} ${y})" data-mark-id="${escapeSvg(mark.id)}" tabindex="0" role="button" aria-label="${escapeSvg(title)}"><title>${escapeSvg(title)}</title>${shape}<circle class="mark-chip" r="9.5"/><text class="mark-text" y=".5">${number}</text><text class="mark-code" y="25">${code}</text></g>`);
  }
  if (focusTarget?.type === 'mark' && focusTarget.page === page) {
    const item = state.marks.find((mark) => mark.id === focusTarget.id);
    if (item) { const focus = normalizedToDisplay(item, width, height); chunks.push(`<circle class="focus-halo" cx="${focus.x}" cy="${focus.y}" r="23"/>`); }
  }
  if (focusTarget?.type === 'run' && focusTarget.page === page) {
    const run = state.runs.find((item) => item.id === focusTarget.id);
    if (run?.points?.length) {
      const middle = normalizedToDisplay(run.points[Math.floor(run.points.length / 2)], width, height);
      chunks.push(`<circle class="focus-halo" cx="${middle.x}" cy="${middle.y}" r="25"/>`);
    }
  }
  if (focusTarget?.type === 'area' && focusTarget.page === page) {
    const area = state.areas.find((item) => item.id === focusTarget.id);
    if (area?.points?.length) {
      const center = area.points.reduce((result, point) => ({ x: result.x + point.x / area.points.length, y: result.y + point.y / area.points.length }), { x: 0, y: 0 });
      const marker = normalizedToDisplay(center, width, height);
      chunks.push(`<circle class="focus-halo" cx="${marker.x}" cy="${marker.y}" r="25"/>`);
    }
  }
  if (activeDrag && dragSelectionRect) {
    const rect = dragSelectionRect;
    chunks.push(`<rect class="selection-box" x="${Math.min(rect.x, rect.x + rect.width) * width}" y="${Math.min(rect.y, rect.y + rect.height) * height}" width="${Math.abs(rect.width) * width}" height="${Math.abs(rect.height) * height}" rx="3"/>`);
  }
  overlay.innerHTML = chunks.join('');
}

function normalizedPoint(event) {
  const bounds = stage.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  };
}

function getNearestSampleFixture(page, point, category = null) {
  const candidates = SAMPLE_FIXTURES.filter((fixture) => fixture.page === page && (!category || fixture.category === category));
  return candidates.map((fixture) => ({ fixture, separation: distance(fixture, point) })).sort((a, b) => a.separation - b.separation)[0] ?? null;
}

function nextMarkNumber() {
  return Math.max(0, ...state.marks.map((mark) => Number(mark.markNumber) || 0)) + 1;
}

function addManualMark(point, { force = false } = {}) {
  const category = $('#categorySelect').value;
  const sampleFixture = state.document.kind === 'sample' ? getNearestSampleFixture(state.currentPage, point, category) : null;
  const fixture = sampleFixture && sampleFixture.separation <= 0.043 ? sampleFixture.fixture : null;
  if (fixture) {
    const already = state.marks.find((mark) => mark.fixtureRef === fixture.physicalId && mark.status !== 'duplicate' && mark.status !== 'rejected');
    if (already) {
      focusSource({ type: 'mark', id: already.id, page: already.page });
      toast(`${fixture.physicalId} is already marked on ${currentPageLabel(already.page)}. Repeated views are not counted again.`, 'warning');
      return;
    }
  } else if (state.document.kind === 'pdf' && !force) {
    const nearby = state.marks.find((mark) => mark.page === state.currentPage && mark.category === category && distance(mark, point) < 0.009 && mark.status !== 'rejected' && mark.status !== 'duplicate');
    if (nearby) {
      showDialog({
        kicker: 'POSSIBLE OVERLAP', title: 'There is already a mark here',
        content: `<p>A ${escapeHtml(CATEGORIES[category].label.toLocaleLowerCase())} mark already sits close to this point. This may be an overlapping search or a deliberate second item.</p><div class="dialog-info">Existing source: ${escapeHtml(nearby.reference || ('Mark ' + nearby.markNumber))} · ${escapeHtml(currentPageLabel(nearby.page))}). You can inspect it first or explicitly add another mark.</div>`,
        actions: [
          { label: 'Cancel', action: 'cancel' },
          { label: 'Add separate item', variant: 'primary', action: 'add-separate', handler: () => { addManualMark(point, { force: true }); } },
        ],
      });
      return;
    }
  }
  const markNumber = nextMarkNumber();
  const defaults = CATEGORIES[category];
  const mark = {
    id: makeId('mark'), page: state.currentPage, x: point.x, y: point.y, category,
    item: defaults.label, material: '', size: '', quantity: 1, unit: 'ea',
    origin: 'manual', status: 'counted', markNumber,
    reference: fixture?.ref || `Mark ${String(markNumber).padStart(2, '0')}`,
    fixtureRef: fixture?.physicalId ?? null,
    createdAt: new Date().toISOString(),
  };
  state.marks.push(mark);
  selectedObject = { type: 'mark', id: mark.id };
  expandedRowKey = null;
  renderMaterialPanel();
  renderOverlay();
  markDirty();
}

function addRunVertex(point) {
  const last = draftRunPoints.at(-1);
  if (last && distance(last, point) < 0.003) return;
  draftRunPoints.push(point);
  $('#finishRunButton').hidden = draftRunPoints.length < 2;
  renderOverlay();
  const unit = state.calibrations?.[state.currentPage] ? ' calibrated' : ' · no scale yet';
  $('#canvasHint').textContent = `Run trace · ${draftRunPoints.length} point${draftRunPoints.length === 1 ? '' : 's'}${unit}. Add bends, then select Finish run.`;
}

function showDialog({ kicker = 'MATERIAL CALCULATOR', title, content = '', actions = [] }) {
  $('#dialogKicker').textContent = kicker;
  $('#dialogTitle').textContent = title;
  $('#dialogContent').innerHTML = content;
  const actionsRoot = $('#dialogActions');
  actionsRoot.innerHTML = actions.map((item) => {
    const variant = item.variant === 'primary' ? 'button-primary' : item.variant === 'danger' ? 'button-secondary' : 'button-secondary';
    return `<button type="button" class="button ${variant}" data-dialog-action="${escapeHtml(item.action)}">${item.icon || ''}${escapeHtml(item.label)}</button>`;
  }).join('');
  for (const item of actions) {
    const button = $$('[data-dialog-action]', actionsRoot).find((candidate) => candidate.dataset.dialogAction === item.action);
    if (!button) continue;
    button.addEventListener('click', async () => {
      try {
        const result = item.handler ? await item.handler() : undefined;
        if (result !== false && appDialog.open) appDialog.close();
      } catch (error) {
        toast(error.message || 'That action could not be completed.', 'error');
      }
    });
  }
  if (!appDialog.open) appDialog.showModal();
}

function showCalibrationDialog(points) {
  const [a, b] = points;
  const page = state.currentPage;
  const dimensions = getPageIntrinsicDimensions(page);
  const paperDistance = Math.hypot((b.x - a.x) * dimensions.width, (b.y - a.y) * dimensions.height);
  if (paperDistance < 0.5) {
    toast('Choose two points further apart to set a useful reference.', 'warning');
    return;
  }
  const sampleReference = state.document.kind === 'sample' && page === 1;
  showDialog({
    kicker: `SHEET ${currentPageLabel(page)} · CALIBRATION`, title: 'Set a reference distance',
    content: `<p>Scale applies only to ${escapeHtml(currentPageLabel(page))}. Counted items do not need scale; traced lengths on this sheet do.</p>
      ${sampleReference ? '<div class="dialog-info">Sample reference: the dimension line marked 6,000 mm on P-01. Click its two arrow endpoints for the best alignment.</div>' : ''}
      <label class="dialog-field">Known distance <input id="calibrationDistanceInput" type="text" inputmode="decimal" value="${sampleReference ? '6,000' : ''}" placeholder="e.g. 6,000"></label>
      <label class="dialog-field">Unit <select id="calibrationUnitInput"><option value="mm">Millimetres (mm)</option><option value="m">Metres (m)</option></select></label>
      <p class="dialog-help">Enter the printed dimension, not the measurement of your screen. The saved ratio remains valid when you zoom.</p>`,
    actions: [
      { label: 'Cancel', action: 'cancel' },
      { label: 'Save calibration', variant: 'primary', action: 'save-calibration', handler: () => {
        const input = $('#calibrationDistanceInput');
        const distanceValue = parseNumber(input.value);
        if (!Number.isFinite(distanceValue) || distanceValue <= 0) {
          input.setCustomValidity('Enter a distance greater than zero.'); input.reportValidity(); input.focus(); return false;
        }
        const unit = $('#calibrationUnitInput').value;
        const referenceMm = distanceValue * (unit === 'm' ? 1000 : 1);
        state.calibrations[page] = {
          points: [{ ...a }, { ...b }], paperDistance,
          referenceMm, mmPerPaperUnit: referenceMm / paperDistance,
          source: 'user-entered reference', updatedAt: new Date().toISOString(),
        };
        draftCalibrationPoints = [];
        setTool('select');
        renderHeader(); renderMaterialPanel(); renderOverlay(); markDirty();
        toast(`Sheet ${currentPageLabel(page)} calibrated from ${referenceMm.toLocaleString()} mm.`, 'success');
      } },
    ],
  });
}

function finishRun() {
  if (draftRunPoints.length < 2) {
    toast('Add at least two points before finishing a run.', 'warning');
    return;
  }
  const runPoints = draftRunPoints.map((point) => ({ ...point }));
  const page = state.currentPage;
  const calibration = state.calibrations?.[page];
  showDialog({
    kicker: `SHEET ${currentPageLabel(page)} · MEASURED ROUTE`, title: 'Describe this run',
    content: `<p>The route will be saved even if this sheet has no scale. Its length will enter the material list only after a valid calibration.</p>
      <div class="form-two-col"><label class="dialog-field">Material <input id="runMaterialInput" placeholder="Enter material; e.g. PVC" autocomplete="off"></label>
      <label class="dialog-field">Nominal size / diameter <input id="runSizeInput" placeholder="Enter size; e.g. 100 mm" autocomplete="off"></label></div>
      <div class="dialog-info">${calibration ? 'This sheet is calibrated. Length will be calculated from the reference you saved.' : 'No scale is set on this sheet, so only the route evidence will be saved for now.'} No material, diameter, fittings or allowance is assumed.</div>`,
    actions: [
      { label: 'Keep tracing', action: 'cancel' },
      { label: 'Save measured run', variant: 'primary', action: 'save-run', handler: () => {
        const run = {
          id: makeId('run'), page, points: runPoints,
          material: $('#runMaterialInput').value.trim(), size: $('#runSizeInput').value.trim(),
          createdAt: new Date().toISOString(), reference: `Run ${String(state.runs.length + 1).padStart(2, '0')}`,
        };
        state.runs.push(run);
        selectedObject = { type: 'run', id: run.id };
        draftRunPoints = [];
        setTool('select');
        renderMaterialPanel(); renderOverlay(); markDirty();
        if (!calibration) toast('Run saved. Set a calibration on this sheet before including a length.', 'warning');
      } },
    ],
  });
}

function getSingleRunLength(run) {
  const measurements = measureRunGroups([run], state.calibrations, state.pageDimensions);
  const total = measurements.groups.reduce((sum, group) => sum + group.metres, 0);
  return measurements.unscaled.length ? null : total;
}

function getSingleArea(area) {
  const measurements = measureAreaGroups([area], state.calibrations, state.pageDimensions);
  const total = measurements.groups.reduce((sum, group) => sum + group.squareMetres, 0);
  return measurements.unscaled.length ? null : total;
}

function finishArea() {
  if (draftAreaPoints.length < 3) {
    toast('Add at least three boundary points before finishing an area.', 'warning');
    return;
  }
  const points = draftAreaPoints.map((point) => ({ ...point }));
  const page = state.currentPage;
  const calibration = state.calibrations?.[page];
  showDialog({
    kicker: `SHEET ${currentPageLabel(page)} · MEASURED AREA`, title: 'Describe this area',
    content: `<p>The polygon is saved as measured evidence. Square metres are calculated only from this sheet’s explicit calibration.</p>
      <label class="dialog-field">Area / item <input id="areaItemInput" placeholder="e.g. Bedding footprint or plant room" autocomplete="off"></label>
      <div class="form-two-col"><label class="dialog-field">Material <input id="areaMaterialInput" placeholder="Enter material if specified"></label><label class="dialog-field">Size / depth <input id="areaSizeInput" placeholder="Enter if specified"></label></div>
      <div class="dialog-info">${calibration ? 'This page has a valid calibration.' : 'This page has no scale. The boundary is retained, but no area quantity is included until you calibrate it.'} No material, depth or installation rule is assumed.</div>`,
    actions: [
      { label: 'Keep drawing', action: 'cancel' },
      { label: 'Save area', variant: 'primary', action: 'save-area', handler: () => {
        const area = {
          id: makeId('area'), page, points,
          item: $('#areaItemInput').value.trim() || 'Measured area',
          material: $('#areaMaterialInput').value.trim(), size: $('#areaSizeInput').value.trim(),
          unit: 'm²', reference: `Area ${String(state.areas.length + 1).padStart(2, '0')}`,
          createdAt: new Date().toISOString(),
        };
        state.areas.push(area);
        selectedObject = { type: 'area', id: area.id };
        draftAreaPoints = [];
        setTool('select');
        renderMaterialPanel(); renderOverlay(); markDirty();
        if (!calibration) toast('Area boundary saved. Calibrate this sheet before including a square-metre quantity.', 'warning');
      } },
    ],
  });
}

function onStageClick(event) {
  if (ignoreNextClick) { ignoreNextClick = false; return; }
  const markTarget = event.target.closest?.('[data-mark-id]');
  if (markTarget) {
    event.preventDefault(); event.stopPropagation();
    selectedObject = { type: 'mark', id: markTarget.dataset.markId };
    renderMaterialPanel(); renderOverlay();
    return;
  }
  const runTarget = event.target.closest?.('[data-run-id]');
  if (runTarget) {
    event.preventDefault(); event.stopPropagation();
    selectedObject = { type: 'run', id: runTarget.dataset.runId };
    renderMaterialPanel(); renderOverlay();
    return;
  }
  const areaTarget = event.target.closest?.('[data-area-id]');
  if (areaTarget) {
    event.preventDefault(); event.stopPropagation();
    selectedObject = { type: 'area', id: areaTarget.dataset.areaId };
    renderMaterialPanel(); renderOverlay();
    return;
  }
  if (activeTool === 'find' || activeTool === 'search-area') return;
  const point = normalizedPoint(event);
  if (activeTool === 'count') {
    addManualMark(point);
  } else if (activeTool === 'calibrate') {
    draftCalibrationPoints.push(point);
    renderOverlay();
    if (draftCalibrationPoints.length >= 2) showCalibrationDialog(draftCalibrationPoints.slice(0, 2));
  } else if (activeTool === 'measure') {
    addRunVertex(point);
  } else if (activeTool === 'area') {
    const last = draftAreaPoints.at(-1);
    if (!last || distance(last, point) >= 0.003) draftAreaPoints.push(point);
    $('#finishAreaButton').hidden = draftAreaPoints.length < 3;
    renderOverlay();
    $('#canvasHint').textContent = `Area trace · ${draftAreaPoints.length} boundary point${draftAreaPoints.length === 1 ? '' : 's'}. Add corners, then select Finish area.`;
  } else {
    selectedObject = null;
    renderMaterialPanel(); renderOverlay();
  }
}

function onStagePointerDown(event) {
  if (!['find', 'search-area'].includes(activeTool)) return;
  if (event.target.closest?.('[data-mark-id], [data-run-id], [data-area-id]')) return;
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  stage.setPointerCapture?.(event.pointerId);
  activeDrag = { start: normalizedPoint(event), pointerId: event.pointerId };
  dragSelectionRect = { x: activeDrag.start.x, y: activeDrag.start.y, width: 0, height: 0 };
}

function onStagePointerMove(event) {
  if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
  const point = normalizedPoint(event);
  dragSelectionRect = { x: activeDrag.start.x, y: activeDrag.start.y, width: point.x - activeDrag.start.x, height: point.y - activeDrag.start.y };
  renderOverlay();
}

async function onStagePointerUp(event) {
  if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
  const start = activeDrag.start;
  const end = normalizedPoint(event);
  activeDrag = null;
  dragSelectionRect = null;
  renderOverlay();
  ignoreNextClick = true;
  window.setTimeout(() => { ignoreNextClick = false; }, 0);
  const rect = {
    x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y),
  };
  if (rect.width < 0.008 || rect.height < 0.008) {
    toast('Drag a box around the symbol or region; a single click is too small.', 'warning');
    return;
  }
  if (activeTool === 'find') {
    captureExampleSymbol(rect);
  } else if (activeTool === 'search-area') {
    pendingSearchArea = rect;
    setTool('select');
    await performSymbolSearch();
  }
}

function captureExampleSymbol(rect) {
  try {
    const x = Math.max(0, Math.floor(rect.x * planCanvas.width));
    const y = Math.max(0, Math.floor(rect.y * planCanvas.height));
    const width = Math.min(planCanvas.width - x, Math.ceil(rect.width * planCanvas.width));
    const height = Math.min(planCanvas.height - y, Math.ceil(rect.height * planCanvas.height));
    if (width < 14 || height < 14) {
      toast('Select a larger example region around the symbol.', 'warning');
      return;
    }
    const context = planCanvas.getContext('2d', { willReadFrequently: true });
    const imageData = context.getImageData(x, y, width, height);
    const nearest = state.document.kind === 'sample'
      ? getNearestSampleFixture(state.currentPage, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
      : null;
    const fixture = nearest && nearest.separation <= 0.045 ? nearest.fixture : null;
    const category = fixture?.category || $('#categorySelect').value;
    $('#categorySelect').value = category;
    pendingTemplate = { imageData, category, sampleFixture: fixture, samplePage: state.currentPage, rect, label: fixture?.ref || CATEGORIES[category].label };
    setTool('select');
    openSearchOptionsDialog();
  } catch (error) {
    console.error(error);
    setTool('select');
    toast('Could not read that symbol region. Try selecting a smaller area around the drawing symbol.', 'error');
  }
}

function openSearchOptionsDialog() {
  if (!pendingTemplate) return;
  const sampleMode = state.document.kind === 'sample' && Boolean(pendingTemplate.sampleFixture);
  const message = sampleMode
    ? 'On the built-in sample only, candidates come from a manually checked physical-symbol index. Schedule and note text are deliberately excluded; repeated physical references are collapsed.'
    : 'The browser compares same-scale page pixels with your example. It cannot tell a fixture from a similar legend, note, or repeated view; every match stays uncounted until you review it.';
  showDialog({
    kicker: 'SYMBOL SEARCH · REVIEW REQUIRED', title: `Find matches for ${pendingTemplate.label}`,
    content: `<div class="dialog-info">${message}</div>
      <label class="dialog-field">Pages to search <select id="searchPagesInput"><option value="current">Only ${escapeHtml(currentPageLabel(pendingTemplate.samplePage))}</option><option value="all">All ${currentPageCount()} sheets</option></select></label>
      <label class="dialog-field">Search area <select id="searchAreaInput"><option value="full">Entire selected page(s)</option><option value="region">Draw a region on ${escapeHtml(currentPageLabel(pendingTemplate.samplePage))}</option></select></label>
      <label class="dialog-field">Group / label <input id="searchLabelInput" value="${escapeHtml(pendingTemplate.label)}" placeholder="e.g. WC-A" autocomplete="off"></label>
      <p class="dialog-help">The local visual matcher searches for a similar pixel pattern at the current scale. It does not OCR, interpret notes, identify fittings, or provide a certified count. Check candidates and possible repeated views before accepting.</p>`,
    actions: [
      { label: 'Cancel', action: 'cancel', handler: () => { pendingTemplate = null; pendingSearchConfig = null; setTool('select'); } },
      { label: 'Continue', variant: 'primary', action: 'start-search', handler: () => {
        const pageScope = $('#searchPagesInput').value;
        const areaChoice = $('#searchAreaInput').value;
        const label = $('#searchLabelInput').value.trim() || pendingTemplate.label;
        pendingSearchConfig = { pageScope, areaChoice, label, examplePage: pendingTemplate.samplePage };
        if (areaChoice === 'region') {
          pendingSearchArea = null;
          setTool('search-area');
          toast('Drag a rectangle around the area to search.', 'success');
        } else {
          pendingSearchArea = null;
          window.setTimeout(() => performSymbolSearch(), 0);
        }
      } },
    ],
  });
}

function selectedPagesForSearch() {
  if (!pendingSearchConfig) return [];
  if (pendingSearchConfig.pageScope === 'all') return Array.from({ length: currentPageCount() }, (_, index) => index + 1);
  return [pendingSearchConfig.examplePage];
}

async function performSymbolSearch() {
  if (!pendingTemplate || !pendingSearchConfig) return;
  const config = pendingSearchConfig;
  const category = pendingTemplate.category;
  const selectedPages = selectedPagesForSearch();
  const candidates = [];
  let duplicateReferencesCollapsed = 0;
  let ignoredSamePage = 0;
  const existing = state.marks.filter((mark) => mark.status !== 'rejected' && mark.status !== 'duplicate');
  currentSearchBatchId = makeId('search');
  try {
    if (state.document.kind === 'sample' && pendingTemplate.sampleFixture) {
      const physicalById = new Map();
      for (const fixture of SAMPLE_FIXTURES.filter((item) => selectedPages.includes(item.page) && item.category === category)) {
        if (physicalById.has(fixture.physicalId)) {
          duplicateReferencesCollapsed += 1;
          continue;
        }
        physicalById.set(fixture.physicalId, fixture);
      }
      for (const fixture of physicalById.values()) {
        if (existing.some((mark) => mark.fixtureRef === fixture.physicalId)) {
          duplicateReferencesCollapsed += 1;
          continue;
        }
        candidates.push({
          id: makeId('candidate'), page: fixture.page, x: fixture.x, y: fixture.y,
          category, item: CATEGORIES[category].label, material: '', size: '', quantity: 1, unit: 'ea',
          origin: 'sample-reference', status: 'review', markNumber: null, fixtureRef: fixture.physicalId,
          reference: fixture.ref, searchBatchId: currentSearchBatchId, confidence: 1,
          searchLabel: config.label, uncertain: false, createdAt: new Date().toISOString(),
        });
      }
    } else {
      for (const page of selectedPages) {
        const canvas = page === state.currentPage
          ? planCanvas
          : await renderPdfPageToImage(pdfDocument, page, getFitWidth());
        const area = pendingSearchArea ?? { x: 0, y: 0, width: 1, height: 1 };
        const cropX = Math.max(0, Math.floor(area.x * canvas.width));
        const cropY = Math.max(0, Math.floor(area.y * canvas.height));
        const cropWidth = Math.max(1, Math.min(canvas.width - cropX, Math.ceil(area.width * canvas.width)));
        const cropHeight = Math.max(1, Math.min(canvas.height - cropY, Math.ceil(area.height * canvas.height)));
        const crop = canvas.getContext('2d', { willReadFrequently: true }).getImageData(cropX, cropY, cropWidth, cropHeight);
        const matches = matchTemplate(crop, pendingTemplate.imageData, { threshold: 0.87, maxMatches: 120, stride: 3 });
        for (const match of matches) {
          const x = (cropX + match.x + match.width / 2) / canvas.width;
          const y = (cropY + match.y + match.height / 2) / canvas.height;
          candidates.push({
            id: makeId('candidate'), page, x, y, category, item: CATEGORIES[category].label,
            material: '', size: '', quantity: 1, unit: 'ea', origin: 'local-template', status: 'review',
            markNumber: null, reference: `${config.label} candidate`, searchBatchId: currentSearchBatchId,
            confidence: match.score, searchLabel: config.label, uncertain: true,
            crossPageNeedsReview: config.pageScope === 'all' && page !== config.examplePage,
            candidateBounds: {
              x: (cropX + match.x) / canvas.width, y: (cropY + match.y) / canvas.height,
              width: match.width / canvas.width, height: match.height / canvas.height,
            }, createdAt: new Date().toISOString(),
          });
        }
      }
    }

    const deduped = removeDuplicateCandidates(candidates, existing, { pageSize: 0.026, globalSize: 0.014 });
    ignoredSamePage = deduped.samePageDuplicates;
    for (const candidate of deduped.matches) {
      candidate.markNumber = null;
      state.marks.push(candidate);
    }
    const count = deduped.matches.length;
    pendingTemplate = null;
    pendingSearchConfig = null;
    pendingSearchArea = null;
    setTool('select');
    renderHeader(); renderMaterialPanel(); renderOverlay(); markDirty();
    if (count === 0) {
      const reason = state.document.kind === 'sample' ? 'No uncounted physical symbols of this category were found in the selected sheets.' : 'No close pixel matches crossed the review threshold. Try a tighter example or another zoom level.';
      toast(`${reason}${duplicateReferencesCollapsed || ignoredSamePage ? ` ${duplicateReferencesCollapsed + ignoredSamePage} repeated / already-marked candidate${duplicateReferencesCollapsed + ignoredSamePage === 1 ? '' : 's'} skipped.` : ''}`, 'warning', 6500);
    } else {
      const repeatCount = deduped.possibleCrossPageRepeats;
      const summary = state.document.kind === 'sample'
        ? `Found ${count} unique indexed physical ${CATEGORIES[category].label.toLocaleLowerCase()} symbol${count === 1 ? '' : 's'}. ${duplicateReferencesCollapsed} repeated / already-marked reference${duplicateReferencesCollapsed === 1 ? '' : 's'} collapsed; notes and schedules are not counted.`
        : `Found ${count} possible pixel match${count === 1 ? '' : 'es'} across ${selectedPages.length} sheet${selectedPages.length === 1 ? '' : 's'}. ${ignoredSamePage} overlapping match${ignoredSamePage === 1 ? '' : 'es'} skipped.${repeatCount ? ` ${repeatCount} possible repeated-view match${repeatCount === 1 ? '' : 'es'} flagged.` : ''} All remain uncounted until reviewed.`;
      toast(summary, state.document.kind === 'sample' ? 'success' : 'warning', 7000);
      openReviewGroupDialog(currentSearchBatchId);
    }
  } catch (error) {
    console.error(error);
    pendingTemplate = null;
    pendingSearchConfig = null;
    pendingSearchArea = null;
    setTool('select');
    toast(`Symbol search could not finish. You can still count by hand. ${error.message}`, 'error', 7000);
  }
}

function acceptCandidate(mark, { confirmedRepeat = false } = {}) {
  if (mark.possibleRepeatOf && !confirmedRepeat) return false;
  mark.status = 'counted';
  mark.markNumber = nextMarkNumber();
  mark.uncertain = mark.origin === 'local-template' || Boolean(mark.uncertain);
  mark.reviewedAt = new Date().toISOString();
  mark.reference = mark.fixtureRef || `Mark ${String(mark.markNumber).padStart(2, '0')}`;
  if (confirmedRepeat) {
    mark.possibleRepeatOf = null;
    mark.possibleRepeatPage = null;
    mark.crossPageNeedsReview = false;
    mark.repeatDecision = 'kept-as-separate-item';
  }
  selectedObject = { type: 'mark', id: mark.id };
  markDirty();
  renderMaterialPanel(); renderOverlay();
  return true;
}

function rejectCandidate(mark, reason = 'removed') {
  if (reason === 'duplicate') {
    mark.status = 'duplicate';
    mark.repeatDecision = 'duplicate-view';
    mark.reviewedAt = new Date().toISOString();
  } else {
    state.marks = state.marks.filter((item) => item.id !== mark.id);
  }
  if (selectedObject?.id === mark.id) selectedObject = null;
  markDirty(); renderMaterialPanel(); renderOverlay();
}

function requiresRepeatDecision(mark) {
  return Boolean(mark?.possibleRepeatOf || mark?.crossPageNeedsReview);
}

function openReviewGroupDialog(batchId = null) {
  const candidates = state.marks.filter((mark) => mark.status === 'review' && (!batchId || mark.searchBatchId === batchId));
  if (!candidates.length) {
    toast('No unreviewed symbol candidates remain.', 'success');
    if (appDialog.open) appDialog.close();
    return;
  }
  const safeCount = candidates.filter((item) => !requiresRepeatDecision(item)).length;
  const content = `<div class="dialog-warning"><span>!</span><span>These ${candidates.length} candidate${candidates.length === 1 ? '' : 's'} are evidence to review, not counts. The PDF visual matcher cannot distinguish a plumbing fixture from similar text or symbols. Accept only after checking the plan.</span></div>
    <div class="review-actions"><button class="button button-secondary" id="acceptSafeCandidatesButton" type="button">Accept ${safeCount} without repeat warning</button><span class="dialog-help">Ambiguous repeated-view candidates need a separate decision.</span></div>
    <div class="candidate-review-list">${candidates.map((mark, index) => `<div class="candidate-review-row">
      <span class="candidate-code" aria-hidden="true">${index + 1}</span><div><strong>${escapeHtml(CATEGORIES[mark.category]?.label || 'Fitting')} · ${escapeHtml(currentPageLabel(mark.page))}${mark.reference ? ` · ${escapeHtml(mark.reference)}` : ''}</strong>
      <span>${mark.origin === 'sample-reference' ? 'Verified sample index · physical symbol' : `Visual similarity ${Math.round((mark.confidence || 0) * 100)}% · uncertain candidate`}${mark.possibleRepeatOf ? ` · possible repeat of ${escapeHtml(currentPageLabel(mark.possibleRepeatPage))}` : mark.crossPageNeedsReview ? ' · compare for repeated view' : ''}</span></div>
      ${requiresRepeatDecision(mark) ? `<button type="button" class="approve-candidate" data-candidate-action="keep" data-candidate-id="${escapeHtml(mark.id)}">Keep separate</button><button type="button" data-candidate-action="duplicate" data-candidate-id="${escapeHtml(mark.id)}">Treat as repeat</button>` : `<button type="button" class="approve-candidate" data-candidate-action="accept" data-candidate-id="${escapeHtml(mark.id)}">Accept</button>`}
      <button type="button" data-candidate-action="remove" data-candidate-id="${escapeHtml(mark.id)}">Remove</button>
    </div>`).join('')}</div>
    <p class="dialog-help">Numbered marks stay on the sheet. Select one later to change its category, material, size or quantity. Removing a candidate does not affect other marks.</p>`;
  showDialog({
    kicker: 'GROUP REVIEW', title: 'Review symbol matches', content,
    actions: [
      { label: 'Done', action: 'done' },
    ],
  });
  $('#acceptSafeCandidatesButton')?.addEventListener('click', () => {
    const safe = state.marks.filter((mark) => mark.status === 'review' && (!batchId || mark.searchBatchId === batchId) && !mark.possibleRepeatOf);
    for (const mark of safe) acceptCandidate(mark);
    openReviewGroupDialog(batchId);
  });
  $$('[data-candidate-action]').forEach((button) => button.addEventListener('click', () => {
    const mark = state.marks.find((item) => item.id === button.dataset.candidateId);
    if (!mark) return;
    if (button.dataset.candidateAction === 'accept') acceptCandidate(mark);
    if (button.dataset.candidateAction === 'keep') acceptCandidate(mark, { confirmedRepeat: true });
    if (button.dataset.candidateAction === 'duplicate') rejectCandidate(mark, 'duplicate');
    if (button.dataset.candidateAction === 'remove') rejectCandidate(mark, 'removed');
    openReviewGroupDialog(batchId);
  }));
}

function showAddMaterialDialog() {
  showDialog({
    kicker: `SHEET ${currentPageLabel()} · MANUAL ENTRY`, title: 'Add material to the list',
    content: `<p>Enter what is actually specified or counted. This entry is manual; V1 does not add fittings or installation requirements for you.</p>
      <label class="dialog-field">Item <input id="manualItemInput" placeholder="e.g. Brass isolation valve" autocomplete="off"></label>
      <div class="form-two-col"><label class="dialog-field">Material <input id="manualMaterialInput" placeholder="Enter material"></label><label class="dialog-field">Size <input id="manualSizeInput" placeholder="Enter size"></label></div>
      <div class="form-two-col"><label class="dialog-field">Quantity <input id="manualQuantityInput" type="text" inputmode="decimal" value="1"></label><label class="dialog-field">Unit <select id="manualUnitInput"><option value="ea">each (ea)</option><option value="m">metres (m)</option><option value="mm">millimetres (mm)</option><option value="m²">square metres (m²)</option><option value="m³">cubic metres (m³)</option><option value="bag">bag</option><option value="roll">roll</option><option value="box">box</option></select></label></div>
      <label class="dialog-field">Source / reference <input id="manualReferenceInput" value="${escapeHtml(currentPageLabel())}" placeholder="Sheet, dimension or note reference"></label>`,
    actions: [
      { label: 'Cancel', action: 'cancel' },
      { label: 'Add to materials', variant: 'primary', action: 'add-manual', handler: () => {
        const itemInput = $('#manualItemInput');
        const quantity = parseNumber($('#manualQuantityInput').value);
        if (!itemInput.value.trim()) { itemInput.setCustomValidity('Enter an item name.'); itemInput.reportValidity(); itemInput.focus(); return false; }
        if (!Number.isFinite(quantity) || quantity <= 0) { $('#manualQuantityInput').setCustomValidity('Enter a quantity greater than zero.'); $('#manualQuantityInput').reportValidity(); $('#manualQuantityInput').focus(); return false; }
        const entry = {
          id: makeId('manual'), item: itemInput.value.trim(), material: $('#manualMaterialInput').value.trim(),
          size: $('#manualSizeInput').value.trim(), quantity, unit: $('#manualUnitInput').value,
          page: state.currentPage, reference: $('#manualReferenceInput').value.trim() || currentPageLabel(),
          note: 'Manual entry', createdAt: new Date().toISOString(),
        };
        state.manualMaterials.push(entry);
        selectedObject = { type: 'manual', id: entry.id };
        renderMaterialPanel(); markDirty(); toast('Manual material added to the live list.');
      } },
    ],
  });
}

function openEditMarkGroupDialog(rowKey) {
  const row = buildMaterialRows(state).find((item) => item.key === rowKey);
  const markIds = new Set((row?.sources ?? []).filter((source) => source.type === 'mark').map((source) => source.id));
  if (!markIds.size) return;
  const firstMark = state.marks.find((mark) => markIds.has(mark.id));
  showDialog({
    kicker: 'BATCH CORRECTION', title: `Edit ${markIds.size} marks together`,
    content: `<p>Apply this category, material and size to the ${markIds.size} counted marks in this grouped row. Their positions, pages and individual review history stay unchanged.</p>
      <label class="dialog-field">Category <select id="groupCategoryInput">${categorySelectOptions(firstMark?.category || 'other')}</select></label>
      <div class="form-two-col"><label class="dialog-field">Material <input id="groupMaterialInput" value="${escapeHtml(firstMark?.material ?? '')}" placeholder="Enter material"></label><label class="dialog-field">Size <input id="groupSizeInput" value="${escapeHtml(firstMark?.size ?? '')}" placeholder="Enter size"></label></div>`,
    actions: [
      { label: 'Cancel', action: 'cancel' },
      { label: 'Update group', variant: 'primary', action: 'update-group', handler: () => {
        const category = $('#groupCategoryInput').value;
        const item = CATEGORIES[category].label;
        state.marks = state.marks.map((mark) => markIds.has(mark.id) ? {
          ...mark, category, item, material: $('#groupMaterialInput').value.trim(), size: $('#groupSizeInput').value.trim(),
        } : mark);
        markDirty(); renderMaterialPanel(); renderOverlay(); toast(`${markIds.size} grouped marks updated.`);
      } },
    ],
  });
}

function openEditManualGroupDialog(rowKey) {
  openEditMarkGroupDialog(rowKey);
}

function focusSource(source) {
  if (!source?.page) return;
  state.currentPage = Math.min(Math.max(1, Number(source.page) || 1), currentPageCount());
  if (source.type === 'mark') selectedObject = { type: 'mark', id: source.id };
  else if (source.type === 'run') selectedObject = { type: 'run', id: source.id };
  else if (source.type === 'area') selectedObject = { type: 'area', id: source.id };
  else if (source.type === 'manual') selectedObject = { type: 'manual', id: source.id };
  focusTarget = { type: source.type, id: source.id, page: state.currentPage };
  renderHeader(); renderMaterialPanel(); renderPlan(); markDirty();
  if (window.innerWidth <= 850) closeMaterialPanel();
  window.setTimeout(() => { focusTarget = null; renderOverlay(); }, 2300);
}

function scrollToFocusTarget(target) {
  if (!target || target.page !== state.currentPage) return;
  const object = target.type === 'mark' ? state.marks.find((mark) => mark.id === target.id)
    : target.type === 'run' ? state.runs.find((run) => run.id === target.id)
      : state.areas.find((area) => area.id === target.id);
  if (!object) return;
  let point = object;
  if (target.type === 'run') point = object.points?.[Math.floor((object.points?.length || 1) / 2)] || object.points?.[0];
  if (target.type === 'area' && object.points?.length) point = object.points.reduce((result, item) => ({ x: result.x + item.x / object.points.length, y: result.y + item.y / object.points.length }), { x: 0, y: 0 });
  if (!point) return;
  const displayed = normalizedToDisplay(point, displayWidth, displayHeight);
  const x = displayed.x;
  const y = displayed.y;
  const left = stage.offsetLeft + x - viewport.clientWidth / 2;
  const top = stage.offsetTop + y - viewport.clientHeight / 2;
  viewport.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: 'smooth' });
}

function removeSource(type, id) {
  if (type === 'mark') state.marks = state.marks.filter((mark) => mark.id !== id);
  if (type === 'run') state.runs = state.runs.filter((run) => run.id !== id);
  if (type === 'area') state.areas = state.areas.filter((area) => area.id !== id);
  if (type === 'manual') state.manualMaterials = state.manualMaterials.filter((item) => item.id !== id);
  if (selectedObject?.id === id) selectedObject = null;
  markDirty(); renderMaterialPanel(); renderOverlay();
  toast(`${type === 'mark' ? 'Mark' : type === 'run' ? 'Run' : 'Manual material'} removed from this calculator.`, 'warning');
}

function saveSelectedCorrection(type) {
  if (!selectedObject) return;
  const { id } = selectedObject;
  if (type === 'mark') {
    const category = $('#selectedCategoryInput').value;
    const quantity = Math.max(1, Math.round(parseNumber($('#selectedQuantityInput').value) || 1));
    const selected = state.marks.find((mark) => mark.id === id);
    if (!selected) return;
    Object.assign(selected, {
      category, item: CATEGORIES[category].label, material: $('#selectedMaterialInput').value.trim(),
      size: $('#selectedSizeInput').value.trim(), quantity,
    });
  } else if (type === 'run') {
    const run = state.runs.find((item) => item.id === id);
    if (!run) return;
    run.material = $('#selectedRunMaterialInput').value.trim();
    run.size = $('#selectedRunSizeInput').value.trim();
  } else if (type === 'area') {
    const area = state.areas.find((item) => item.id === id);
    if (!area) return;
    area.item = $('#selectedAreaItemInput').value.trim() || 'Measured area';
    area.material = $('#selectedAreaMaterialInput').value.trim();
    area.size = $('#selectedAreaSizeInput').value.trim();
  } else if (type === 'manual') {
    const entry = state.manualMaterials.find((item) => item.id === id);
    if (!entry) return;
    const quantity = parseNumber($('#selectedManualQuantityInput').value);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      $('#selectedManualQuantityInput').setCustomValidity('Enter a quantity greater than zero.');
      $('#selectedManualQuantityInput').reportValidity(); return;
    }
    entry.item = $('#selectedManualItemInput').value.trim() || 'Manual material';
    entry.material = $('#selectedManualMaterialInput').value.trim();
    entry.size = $('#selectedManualSizeInput').value.trim();
    entry.quantity = quantity;
  }
  markDirty(); renderMaterialPanel(); renderOverlay(); toast('Correction saved to the live material list.');
}

function handleSelectedEditorClick(event) {
  const save = event.target.closest?.('[data-edit-save]');
  if (save) { saveSelectedCorrection(save.dataset.editSave); return; }
  const remove = event.target.closest?.('[data-delete-selected]');
  if (remove) { removeSource(remove.dataset.deleteSelected, selectedObject?.id); return; }
  const accept = event.target.closest?.('[data-review-accept]');
  if (accept) {
    const mark = state.marks.find((item) => item.id === accept.dataset.reviewAccept);
    if (requiresRepeatDecision(mark)) {
      toast('This candidate may be a repeated view. Use Review group and choose “Keep separate” or “Treat as repeat”.', 'warning');
      openReviewGroupDialog(mark.searchBatchId); return;
    }
    if (mark) { acceptCandidate(mark); }
  }
}

function openRestoreDialog() {
  const last = store.loadLast();
  if (!last) {
    toast('There is no saved workspace to restore yet.', 'warning');
    return;
  }
  const loaded = migrateState(last);
  showDialog({
    kicker: 'LOCAL WORKSPACE', title: 'Restore last saved version?',
    content: `<p>Restore <strong>${escapeHtml(loaded.document.name)}</strong> for <strong>${escapeHtml(loaded.project.name)}</strong> from this browser.</p><div class="dialog-warning"><span>!</span><span>Unsaved changes in the current workspace will be replaced by the last saved version.</span></div>`,
    actions: [
      { label: 'Cancel', action: 'cancel' },
      { label: 'Restore saved version', variant: 'primary', action: 'restore', handler: async () => {
        if (loaded.document.kind === 'pdf') {
          try {
            const bytes = await loadDocumentBytes(loaded.document.fileKey || loaded.document.id);
            if (!bytes) throw new Error('The saved PDF file is not in this browser. Reopen that PDF from your device.');
            pdfBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            pdfDocument?.destroy?.();
            pdfDocument = await loadPdfDocument(pdfBytes);
          } catch (error) {
            toast(error.message, 'error');
            return false;
          }
        } else {
          pdfDocument = null; pdfBytes = null;
        }
        state = loaded; selectedObject = null; expandedRowKey = null; lastSavedAt = loaded.updatedAt;
        currentZoom = 1; setTool('select');
        renderHeader(); renderMaterialPanel(); await renderPlan();
        toast('Saved plan, marks, measurements and takeoff restored.');
      } },
    ],
  });
}

async function fingerprint(bytes) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  } catch {
    const view = new Uint8Array(bytes);
    let hash = 2166136261;
    for (let index = 0; index < view.length; index += Math.max(1, Math.floor(view.length / 100000))) {
      hash ^= view[index]; hash = Math.imul(hash, 16777619);
    }
    return `${view.length.toString(16)}-${(hash >>> 0).toString(16)}`;
  }
}

async function getPdfPageDimensions(pdf) {
  const dimensions = {};
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewportAtOne = page.getViewport({ scale: 1 });
    dimensions[pageNumber] = { width: viewportAtOne.width, height: viewportAtOne.height };
  }
  return dimensions;
}

async function openPdfFile(file) {
  if (!file) return;
  if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    toast('Choose a PDF document.', 'warning'); return;
  }
  setSaveState('saving', 'Opening PDF…');
  try {
    const buffer = await file.arrayBuffer();
    const nextPdf = await loadPdfDocument(buffer);
    const id = await fingerprint(buffer);
    const project = { ...state.project, id: state.project.id || slugify(state.project.name) };
    const base = createDefaultState();
    base.project = project;
    base.document = { id, fileKey: id, name: file.name || 'Local plan.pdf', kind: 'pdf', pageCount: nextPdf.numPages };
    base.currentPage = 1;
    base.pageDimensions = await getPdfPageDimensions(nextPdf);
    const previous = store.load(base);
    state = previous ? migrateState(previous) : base;
    state.project = project;
    state.document = base.document;
    state.pageDimensions = previous?.pageDimensions ?? base.pageDimensions;
    state.document.pageCount = nextPdf.numPages;
    state.currentPage = Math.min(state.currentPage, nextPdf.numPages);
    pdfDocument?.destroy?.();
    pdfDocument = nextPdf;
    pdfBytes = new Uint8Array(buffer);
    try {
      await saveDocumentBytes(id, buffer);
      pendingStorageWarning = '';
    } catch (error) {
      pendingStorageWarning = `PDF opened, but the file itself could not be kept in browser storage (${error.message}). Marks will still save; choose this PDF again after a refresh.`;
    }
    selectedObject = null; expandedRowKey = null; currentZoom = 1;
    setTool('select');
    renderHeader(); renderMaterialPanel(); await renderPlan();
    markDirty();
    if (pendingStorageWarning) toast(pendingStorageWarning, 'warning', 8000);
    else toast(previous ? 'Saved workspace for this document restored.' : 'PDF opened. Count, calibrate and trace on its sheets.', 'success');
  } catch (error) {
    console.error(error);
    setSaveState('failed', 'PDF could not be opened');
    toast(`Could not open this PDF. ${error.message || 'It may be password-protected or damaged.'}`, 'error', 7000);
  }
}

async function reopenLastWorkspace() {
  const latest = store.loadLast();
  if (!latest) { toast('No saved workspace is available in this browser.', 'warning'); return; }
  const restored = migrateState(latest);
  if (restored.document.kind === 'pdf') {
    try {
      const bytes = await loadDocumentBytes(restored.document.fileKey || restored.document.id);
      if (!bytes) throw new Error('The PDF file is not available in local browser storage. Select Open PDF and choose that file again.');
      const nextPdf = await loadPdfDocument(bytes);
      pdfDocument?.destroy?.(); pdfDocument = nextPdf;
      pdfBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    } catch (error) {
      toast(error.message, 'error', 7000); return;
    }
  } else {
    pdfDocument = null; pdfBytes = null;
  }
  state = restored; selectedObject = null; expandedRowKey = null; currentZoom = 1; lastSavedAt = restored.updatedAt;
  setTool('select'); renderHeader(); renderMaterialPanel(); await renderPlan();
  toast('Last saved workspace restored from this device.');
}

function exportCsv() {
  const rows = buildMaterialRows(state);
  if (!rows.length) { toast('There are no material rows to export yet.', 'warning'); return; }
  const labels = Object.fromEntries(Array.from({ length: currentPageCount() }, (_, index) => [index + 1, currentPageLabel(index + 1)]));
  const csv = rowsToCsv(rows, labels);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${slugify(state.project.name)}-${slugify(state.document.name)}-materials.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${rows.length} material row${rows.length === 1 ? '' : 's'} with source page references.`);
}

function applyToTakeoff() {
  const rows = buildMaterialRows(state);
  if (!rows.length) { toast('Add a reviewed quantity before applying it to takeoff.', 'warning'); return; }
  const previousCount = state.takeoff.filter((item) => item.source === 'material-calculator').length;
  const externalCount = state.takeoff.filter((item) => item.source !== 'material-calculator').length;
  state.takeoff = applyCalculatorRowsToTakeoff(state.takeoff, rows);
  state.lastAppliedAt = new Date().toISOString();
  const nextCount = state.takeoff.filter((item) => item.source === 'material-calculator').length;
  const feedback = previousCount ? `Updated ${nextCount} linked line${nextCount === 1 ? '' : 's'} without adding duplicates.` : `Added ${nextCount} linked line${nextCount === 1 ? '' : 's'} to this document's takeoff.`;
  $('#applyFeedback').textContent = `${feedback} ${externalCount} other row${externalCount === 1 ? '' : 's'} preserved.`;
  renderMaterialPanel(); markDirty();
  toast(feedback);
}

function setPage(nextPage) {
  const page = Math.min(currentPageCount(), Math.max(1, nextPage));
  if (page === state.currentPage) return;
  state.currentPage = page;
  selectedObject = null;
  renderHeader(); renderMaterialPanel(); renderPlan(); markDirty();
  if (window.innerWidth <= 850) closeMaterialPanel();
}

function openSamplePlan() {
  if (state.document.kind === 'sample') return;
  saveNow({ silent: true });
  const next = createDefaultState();
  next.project = { ...state.project };
  const existing = store.load(next);
  state = existing ? migrateState(existing) : next;
  pdfDocument?.destroy?.(); pdfDocument = null; pdfBytes = null;
  selectedObject = null; expandedRowKey = null; currentZoom = 1;
  setTool('select'); renderHeader(); renderMaterialPanel(); renderPlan();
  toast('Opened the manually checked sample plan.');
}

function closeMaterialPanel() {
  $('#materialPanel').classList.remove('mobile-open');
  $('#mobileMaterialsButton').setAttribute('aria-expanded', 'false');
  $('#mobilePanelScrim').hidden = true;
}

function openMaterialPanel() {
  $('#materialPanel').classList.add('mobile-open');
  $('#mobileMaterialsButton').setAttribute('aria-expanded', 'true');
  $('#mobilePanelScrim').hidden = false;
}

function handleMaterialListClick(event) {
  const rowButton = event.target.closest?.('[data-material-row]');
  if (rowButton) {
    const key = rowButton.dataset.materialRow;
    const rows = buildMaterialRows(state);
    const row = rows.find((item) => item.key === key);
    expandedRowKey = expandedRowKey === key ? null : key;
    if (row?.sources?.length) {
      const first = row.sources.find((source) => source.page && (source.type === 'mark' || source.type === 'run')) || row.sources[0];
      if (first?.page) focusSource(first);
      else renderMaterialPanel();
    } else renderMaterialPanel();
    return;
  }
  const editGroup = event.target.closest?.('[data-edit-group]');
  if (editGroup) { openEditMarkGroupDialog(editGroup.dataset.editGroup); return; }
  const sourceLink = event.target.closest?.('[data-source-type]');
  if (sourceLink) {
    focusSource({ type: sourceLink.dataset.sourceType, id: sourceLink.dataset.sourceId, page: Number(sourceLink.dataset.sourcePage) });
    return;
  }
  const removeButton = event.target.closest?.('[data-remove-source-type]');
  if (removeButton) {
    removeSource(removeButton.dataset.removeSourceType, removeButton.dataset.removeSourceId);
  }
}

function onCalculationInput(event) {
  const idToKey = {
    pipeWasteInput: 'pipeWastePct', clipSpacingInput: 'clipSpacingMm', trenchWidthInput: 'trenchWidthMm',
    trenchDepthInput: 'trenchDepthMm', beddingDepthInput: 'beddingDepthMm', spoilExpansionInput: 'spoilExpansionPct',
    beddingMaterialInput: 'beddingMaterial',
  };
  const key = idToKey[event.target.id];
  if (!key) return;
  state.calculationInputs[key] = key === 'pipeWastePct' || key === 'spoilExpansionPct'
    ? (event.target.value === '' ? '' : Number(event.target.value))
    : event.target.value;
  renderMaterialPanel(); renderOverlay(); markDirty();
}

function bindEvents() {
  $('#projectName').addEventListener('change', () => {
    const name = $('#projectName').value.trim() || 'Untitled project';
    if (name === state.project.name) return;
    saveNow({ silent: true });
    const previousName = state.project.name;
    const changed = { ...state, project: { name, id: slugify(name) } };
    const existing = store.load(changed);
    if (existing) {
      state = migrateState(existing);
      state.project.name = name;
    } else {
      state.project = { name, id: slugify(name) };
    }
    $('#projectName').value = name;
    renderHeader(); renderMaterialPanel(); renderPlan(); markDirty();
    if (existing) toast(`Opened the saved workspace for ${name}.`);
    else toast(`Project changed from ${previousName} to ${name}.`);
  });
  $('#saveButton').addEventListener('click', () => {
    if (saveNow()) toast('Plan marks, measurements, inputs and material list saved on this device.');
  });
  $('#reopenButton').addEventListener('click', openRestoreDialog);
  $('#exportCsvButton').addEventListener('click', exportCsv);
  $('#applyToTakeoffButton').addEventListener('click', applyToTakeoff);
  $('#prevPageButton').addEventListener('click', () => setPage(state.currentPage - 1));
  $('#nextPageButton').addEventListener('click', () => setPage(state.currentPage + 1));
  $('#zoomOutButton').addEventListener('click', () => { currentZoom = Math.max(.45, currentZoom / 1.2); renderHeader(); renderPlan(); });
  $('#zoomInButton').addEventListener('click', () => { currentZoom = Math.min(3, currentZoom * 1.2); renderHeader(); renderPlan(); });
  $('#fitButton').addEventListener('click', () => { currentZoom = 1; renderHeader(); renderPlan(); });
  $('#pdfFileInput').addEventListener('change', (event) => { openPdfFile(event.target.files?.[0]); event.target.value = ''; });
  $('#emptyOpenPdfButton').addEventListener('click', () => $('#pdfFileInput').click());
  $('#samplePlanButton').addEventListener('click', openSamplePlan);
  $('#countToolButton').addEventListener('click', () => setTool('count'));
  $('#findToolButton').addEventListener('click', () => setTool('find'));
  $('#calibrateToolButton').addEventListener('click', () => setTool('calibrate'));
  $('#measureToolButton').addEventListener('click', () => setTool('measure'));
  $('#areaToolButton').addEventListener('click', () => setTool('area'));
  $('#finishRunButton').addEventListener('click', finishRun);
  $('#finishAreaButton').addEventListener('click', finishArea);
  $('#addMaterialButton').addEventListener('click', showAddMaterialDialog);
  $('#calculationsShortcut').addEventListener('click', () => {
    const details = $('#calculationSection'); details.open = !details.open;
    details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('#calculationFields').addEventListener('input', onCalculationInput);
  $('#calculationFields').addEventListener('change', onCalculationInput);
  $('#refreshSummaryButton').addEventListener('click', () => { renderMaterialPanel(); renderOverlay(); toast('Material quantities recalculated from saved marks, runs and inputs.'); });
  $('#emptyCountButton').addEventListener('click', () => setTool('count'));
  $('#materialsList').addEventListener('click', handleMaterialListClick);
  $('#selectedItemContent').addEventListener('click', handleSelectedEditorClick);
  $('#clearSelectionButton').addEventListener('click', () => { selectedObject = null; renderMaterialPanel(); renderOverlay(); });
  $('#reviewGroupButton').addEventListener('click', () => openReviewGroupDialog());
  $('#mobileMaterialsButton').addEventListener('click', () => $('#materialPanel').classList.contains('mobile-open') ? closeMaterialPanel() : openMaterialPanel());
  $('#closePanelButton').addEventListener('click', closeMaterialPanel);
  $('#mobilePanelScrim').addEventListener('click', closeMaterialPanel);
  $('#dismissNoteButton').addEventListener('click', () => { $('#recognitionNote').hidden = true; });
  $('#planStage').addEventListener('click', onStageClick);
  $('#planStage').addEventListener('pointerdown', onStagePointerDown);
  $('#planStage').addEventListener('pointermove', onStagePointerMove);
  $('#planStage').addEventListener('pointerup', onStagePointerUp);
  $('#planStage').addEventListener('pointercancel', () => { activeDrag = null; dragSelectionRect = null; renderOverlay(); });
  $('#dialogCloseButton').addEventListener('click', (event) => { event.preventDefault(); appDialog.close(); });
  $('#dialogForm').addEventListener('submit', (event) => { event.preventDefault(); });
  appDialog.addEventListener('click', (event) => { if (event.target === appDialog) appDialog.close(); });
  window.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && document.activeElement?.matches?.('[data-mark-id], [data-run-id], [data-area-id]')) {
      event.preventDefault(); document.activeElement.click();
    }
    if (event.key === 'Escape' && activeTool !== 'select' && !appDialog.open) setTool('select');
    if (event.key === 'Enter' && activeTool === 'measure' && draftRunPoints.length >= 2 && !appDialog.open) finishRun();
    if (event.key === 'Enter' && activeTool === 'area' && draftAreaPoints.length >= 3 && !appDialog.open) finishArea();
  });
  window.addEventListener('resize', () => { renderPlan(); });
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => { if (state.document.kind !== 'pdf' || pdfDocument) renderPlan(); }).observe(viewport);
  }
}

async function restorePdfOnStartup() {
  if (state.document.kind !== 'pdf') return;
  try {
    const bytes = await loadDocumentBytes(state.document.fileKey || state.document.id);
    if (!bytes) {
      pendingStorageWarning = 'This workspace has saved marks, but the local PDF file is unavailable. Choose Open PDF and select the same file to see its marks.';
      renderHeader(); await renderPlan();
      toast(pendingStorageWarning, 'warning', 8000);
      return;
    }
    pdfBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    pdfDocument = await loadPdfDocument(pdfBytes);
    if (pdfDocument.numPages !== state.document.pageCount) {
      state.document.pageCount = pdfDocument.numPages;
      state.pageDimensions = await getPdfPageDimensions(pdfDocument);
    }
    renderHeader(); await renderPlan();
  } catch (error) {
    console.error(error);
    toast(`Saved PDF could not be reopened. Re-select the file to continue. ${error.message}`, 'warning', 8000);
  }
}

async function init() {
  bindEvents();
  renderHeader(); renderMaterialPanel();
  setSaveState('saved', cachedLast ? 'Saved on this device' : 'Local draft');
  await restorePdfOnStartup();
  if (state.document.kind === 'sample') await renderPlan();
  if (window.innerWidth <= 850) closeMaterialPanel();
  if (pendingStorageWarning) console.info(pendingStorageWarning);
}

init();

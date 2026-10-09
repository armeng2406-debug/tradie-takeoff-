// @vitest-environment happy-dom
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/pdfViewer.js', () => ({
  loadPdfDocument: vi.fn(),
  renderPdfPage: vi.fn(),
  renderPdfPageToImage: vi.fn(),
}));

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pointerEvent(type, x, y) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: 1 }, clientX: { value: x }, clientY: { value: y }, button: { value: 0 },
  });
  return event;
}

function clickAtSheetPoint(x, y) {
  const stage = document.querySelector('#planStage');
  const bounds = stage.getBoundingClientRect();
  const width = Number.parseFloat(stage.style.width) || bounds.width;
  const height = Number.parseFloat(stage.style.height) || bounds.height;
  const clientX = bounds.left + x / 1200 * width;
  const clientY = bounds.top + y / 850 * height;
  stage.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, clientX, clientY }));
}

function dragAroundSheetPoint(x, y, radius = 18) {
  const stage = document.querySelector('#planStage');
  const bounds = stage.getBoundingClientRect();
  const width = Number.parseFloat(stage.style.width) || bounds.width;
  const height = Number.parseFloat(stage.style.height) || bounds.height;
  const startX = bounds.left + (x - radius) / 1200 * width;
  const startY = bounds.top + (y - radius) / 850 * height;
  const endX = bounds.left + (x + radius) / 1200 * width;
  const endY = bounds.top + (y + radius) / 850 * height;
  stage.dispatchEvent(pointerEvent('pointerdown', startX, startY));
  stage.dispatchEvent(pointerEvent('pointermove', endX, endY));
  stage.dispatchEvent(pointerEvent('pointerup', endX, endY));
}

let appModule;

describe('Material Calculator browser journey (sample fixture + mocked browser APIs)', () => {
  beforeAll(async () => {
    const source = fs.readFileSync(new URL('../index.html', `file://${process.cwd()}/tests/journey.test.js`), 'utf8');
    const body = source.match(/<body>([\s\S]*)<\/body>/i)?.[1] ?? '';
    document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '');
    localStorage.clear();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
    Object.defineProperty(document.querySelector('#planViewport'), 'clientWidth', { configurable: true, value: 720 });
    Object.defineProperty(document.querySelector('#planViewport'), 'clientHeight', { configurable: true, value: 600 });
    const stage = document.querySelector('#planStage');
    stage.setPointerCapture = () => {};
    stage.getBoundingClientRect = () => ({
      left: 0, top: 0, right: Number.parseFloat(stage.style.width) || 672,
      bottom: Number.parseFloat(stage.style.height) || 476,
      width: Number.parseFloat(stage.style.width) || 672,
      height: Number.parseFloat(stage.style.height) || 476,
    });
    document.querySelector('#planViewport').scrollTo = () => {};
    document.querySelector('#planStage').scrollIntoView = () => {};
    document.querySelector('#calculationSection').scrollIntoView = () => {};

    class MockImage {
      onload = null;
      onerror = null;
      set src(_value) { queueMicrotask(() => this.onload?.()); }
    }
    globalThis.Image = MockImage;
    HTMLCanvasElement.prototype.getContext = function getContext() {
      return {
        setTransform() {}, fillRect() {}, drawImage() {},
        getImageData(_x, _y, width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
      };
    };
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
    }
    if (!HTMLDialogElement.prototype.close) {
      HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };
    }
    window.HTMLElement.prototype.scrollIntoView = () => {};
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:material-test') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    HTMLAnchorElement.prototype.click = vi.fn();

    appModule = await import('../src/main.js');
    await delay(20);
  });

  afterAll(() => {
    appModule = null;
  });

  it('counts, searches and reviews, corrects, calibrates and measures, restores, applies idempotently, and exports', async () => {
    expect(document.querySelector('#documentName').textContent).toContain('Oak Street');

    // Count a physical WC manually. The sample index links it to WC-01.
    document.querySelector('#categorySelect').value = 'toilet';
    document.querySelector('#countToolButton').click();
    clickAtSheetPoint(393, 280);
    expect(document.querySelector('#countedStat').textContent).toBe('1');

    // Correct material and size from the material row's source evidence.
    document.querySelector('.material-row-button').click();
    const materialCorrection = document.querySelector('#selectedMaterialInput');
    materialCorrection.value = 'Ceramic';
    document.querySelector('#selectedSizeInput').value = 'Floor mount';
    document.querySelector('[data-edit-save="mark"]').click();
    expect(document.querySelector('#materialsList').textContent).toContain('Ceramic');
    expect(document.querySelector('#materialsList').textContent).toContain('Floor mount');

    // Search all sheets from a physical sample WC; the detail repeat of WC-01 is collapsed.
    document.querySelector('#findToolButton').click();
    dragAroundSheetPoint(705, 280);
    expect(document.querySelector('#appDialog').open).toBe(true);
    document.querySelector('#searchPagesInput').value = 'all';
    document.querySelector('#searchAreaInput').value = 'full';
    document.querySelector('[data-dialog-action="start-search"]').click();
    await delay(30);
    expect(document.querySelector('#appDialog').open).toBe(true);
    expect(document.querySelector('#acceptSafeCandidatesButton').textContent).toContain('Accept 2');
    document.querySelector('#acceptSafeCandidatesButton').click();
    await delay(5);
    expect(document.querySelector('#countedStat').textContent).toBe('3');
    expect(document.querySelector('#reviewStat').textContent).toBe('0');

    // Calibrate P-01 from its printed 6,000 mm dimension.
    document.querySelector('#calibrateToolButton').click();
    clickAtSheetPoint(165, 740);
    clickAtSheetPoint(765, 740);
    expect(document.querySelector('#calibrationDistanceInput').value.replace(/,/g, '')).toBe('6000');
    document.querySelector('[data-dialog-action="save-calibration"]').click();
    await delay(5);
    expect(document.querySelector('#pageScaleNote').textContent).toContain('Calibrated');

    // Trace a shared plumbing route, explicitly supplying its material and diameter.
    document.querySelector('#measureToolButton').click();
    clickAtSheetPoint(150, 397);
    clickAtSheetPoint(324, 397);
    document.querySelector('#finishRunButton').click();
    document.querySelector('#runMaterialInput').value = 'PVC';
    document.querySelector('#runSizeInput').value = '50 mm';
    document.querySelector('[data-dialog-action="save-run"]').click();
    await delay(5);
    expect(document.querySelector('#materialsList').textContent).toContain('Pipe run');
    expect(document.querySelector('#measuredStat').textContent).toContain('m');

    // Save, then restore the saved page-specific evidence and measurements.
    document.querySelector('#saveButton').click();
    document.querySelector('#reopenButton').click();
    document.querySelector('[data-dialog-action="restore"]').click();
    await delay(10);
    expect(document.querySelector('#countedStat').textContent).toBe('3');
    expect(document.querySelector('#materialsList').textContent).toContain('Pipe run');

    // Apply, re-apply and prove the linked row count is stable.
    document.querySelector('#applyToTakeoffButton').click();
    const firstTakeoffSummary = document.querySelector('#takeoffSummary').textContent;
    document.querySelector('#applyToTakeoffButton').click();
    expect(document.querySelector('#takeoffSummary').textContent).toBe(firstTakeoffSummary);
    expect(document.querySelector('#takeoffSummary').textContent).toContain('other rows preserved');

    // Export action creates a downloadable CSV; source-column content is covered in core tests.
    document.querySelector('#exportCsvButton').click();
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });
});

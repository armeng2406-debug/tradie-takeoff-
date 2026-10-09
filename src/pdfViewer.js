import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function loadPdfDocument(bytes) {
  const typed = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const task = pdfjsLib.getDocument({ data: typed, useSystemFonts: true });
  return task.promise;
}

export async function renderPdfPage(pdfDocument, pageNumber, canvas, cssWidth) {
  const page = await pdfDocument.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const displayScale = Math.max(0.1, cssWidth / baseViewport.width);
  const displayViewport = page.getViewport({ scale: displayScale });
  const outputScale = Math.min(window.devicePixelRatio || 1, 2);
  const renderViewport = page.getViewport({ scale: displayScale * outputScale });
  const context = canvas.getContext('2d', { alpha: false });
  canvas.width = Math.ceil(renderViewport.width);
  canvas.height = Math.ceil(renderViewport.height);
  canvas.style.width = `${displayViewport.width}px`;
  canvas.style.height = `${displayViewport.height}px`;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport: renderViewport, background: '#ffffff' }).promise;
  return {
    width: baseViewport.width,
    height: baseViewport.height,
    displayWidth: displayViewport.width,
    displayHeight: displayViewport.height,
    scale: displayScale,
  };
}

export async function renderPdfPageToImage(pdfDocument, pageNumber, cssWidth) {
  const canvas = document.createElement('canvas');
  await renderPdfPage(pdfDocument, pageNumber, canvas, cssWidth);
  return canvas;
}

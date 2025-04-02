import * as pdfjsLib from 'pdfjs-dist';
// Remove the incorrect worker import
// import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs';

// Configure the worker source using the path from the import map
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.min.mjs';

// --- Polyfill if necessary (older browsers might need this for requestIdleCallback) ---
window.requestIdleCallback = window.requestIdleCallback || function (cb) {
    var start = Date.now();
    return setTimeout(function () {
        cb({
            didTimeout: false,
            timeRemaining: function () {
                return Math.max(0, 50 - (Date.now() - start));
            }
        });
    }, 1);
};

window.cancelIdleCallback = window.cancelIdleCallback || function (id) {
    clearTimeout(id);
};
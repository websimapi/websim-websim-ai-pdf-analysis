import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// --- DOM Elements ---
const uploadContainer = document.getElementById('upload-container');
const uploadZone = document.getElementById('upload-zone');
const pdfUploadInput = document.getElementById('pdf-upload');
const fileInfo = document.getElementById('file-info');
const fileNameEl = document.getElementById('file-name');
const fileSizeEl = document.getElementById('file-size');
const pageCountEl = document.getElementById('page-count');
const processingProgress = document.getElementById('processing-progress');
const progressBar = document.getElementById('progress-bar');
const currentPageEl = document.getElementById('current-page');
const totalPagesEl = document.getElementById('total-pages');
const statusMessageEl = document.getElementById('status-message');

const resultsContainer = document.getElementById('results-container');
const tocList = document.getElementById('toc-list');
const pdfViewer = document.getElementById('pdf-viewer');
const pageImage = document.getElementById('page-image');
const prevPageBtn = document.getElementById('prev-page');
const nextPageBtn = document.getElementById('next-page');
const currentPageDisplay = document.getElementById('current-page-display');
const totalPagesDisplay = document.getElementById('total-pages-display');
const jumpToPageInput = document.getElementById('jump-to-page-input');
const jumpToPageBtn = document.getElementById('jump-to-page-btn');
const analysisOutput = document.getElementById('analysis-output');
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const resetZoomBtn = document.getElementById('reset-zoom');
const exportPageMdBtn = document.getElementById('export-page-md');
const exportAllMdBtn = document.getElementById('export-all-md');
const downloadPageImageBtn = document.getElementById('download-page-image');


// --- State Variables ---
let pdfDoc = null;
let currentPageNum = 1;
let pageAnalyses = []; // Array to store { pageNum: number, imageDataUrl: string, analysis: string, summary: string }
let currentScale = 1.0;
const MAX_FILE_SIZE_MB = 50;
const DPI = 300; // Target DPI for rendering

// --- Event Listeners ---

// Upload Zone Click
uploadZone.addEventListener('click', () => pdfUploadInput.click());

// File Input Change
pdfUploadInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        handleFileUpload(file);
    }
});

// Drag and Drop
uploadZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.stopPropagation();
    uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    event.stopPropagation();
    uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    uploadZone.classList.remove('dragover');
    const file = event.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
        handleFileUpload(file);
    } else {
        alert('Please drop a PDF file.');
    }
});

// Page Navigation
prevPageBtn.addEventListener('click', showPrevPage);
nextPageBtn.addEventListener('click', showNextPage);
jumpToPageBtn.addEventListener('click', jumpToPage);

// Search
searchButton.addEventListener('click', performSearch);
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        performSearch();
    }
});

// Zoom Controls
zoomInBtn.addEventListener('click', () => zoomImage(1.2));
zoomOutBtn.addEventListener('click', () => zoomImage(1 / 1.2));
resetZoomBtn.addEventListener('click', () => {
    currentScale = 1.0;
    pageImage.style.transform = `scale(${currentScale})`;
     pageImage.style.cursor = 'zoom-in';
});
pageImage.addEventListener('click', () => zoomImage(1.5)); // Zoom in on click

// Export Buttons
exportPageMdBtn.addEventListener('click', exportCurrentPageMarkdown);
exportAllMdBtn.addEventListener('click', exportAllMarkdown);
downloadPageImageBtn.addEventListener('click', downloadCurrentImage);


// --- Functions ---

/**
 * Handles the uploaded PDF file.
 * @param {File} file The PDF file object.
 */
async function handleFileUpload(file) {
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        alert(`File size exceeds the limit of ${MAX_FILE_SIZE_MB}MB.`);
        return;
    }

    // Reset state
    pdfDoc = null;
    currentPageNum = 1;
    pageAnalyses = [];
    tocList.innerHTML = '';
    analysisOutput.innerHTML = 'Loading analysis...';
    resultsContainer.style.display = 'none';
    uploadContainer.style.display = 'none'; // Hide upload once processing starts
    processingProgress.style.display = 'block';
    fileInfo.style.display = 'block';


    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB`;

    updateProgress(0, 0, 0, 'Reading PDF...');

    const fileReader = new FileReader();
    fileReader.onload = async function() {
        const typedarray = new Uint8Array(this.result);
        try {
            const loadingTask = pdfjsLib.getDocument({ data: typedarray });
            pdfDoc = await loadingTask.promise;

            pageCountEl.textContent = pdfDoc.numPages;
            totalPagesEl.textContent = pdfDoc.numPages;
            totalPagesDisplay.textContent = pdfDoc.numPages;
            jumpToPageInput.max = pdfDoc.numPages;


            // Start processing pages
            await processAllPages();

        } catch (error) {
            console.error("Error loading PDF:", error);
            alert(`Error loading PDF: ${error.message}`);
            resetUI();
        }
    };
    fileReader.readAsArrayBuffer(file);
}

/**
 * Processes all pages of the PDF: renders image and gets LLM analysis.
 */
async function processAllPages() {
    if (!pdfDoc) return;
    const numPages = pdfDoc.numPages;

     try {
        for (let i = 1; i <= numPages; i++) {
            updateProgress(i, numPages, (i / numPages) * 100, `Processing page ${i}...`);
            statusMessageEl.textContent = `Rendering page ${i} image...`;
            const imageDataUrl = await renderPageAsImage(i);

            statusMessageEl.textContent = `Analyzing page ${i} with LLM...`;
            const analysis = await getLLMAnalysis(imageDataUrl, i);

            const summary = await getPageSummary(analysis, i); // Get a short summary for TOC


            pageAnalyses.push({
                pageNum: i,
                imageDataUrl: imageDataUrl,
                analysis: analysis || "Analysis failed for this page.",
                summary: summary || `Page ${i}` // Fallback summary
            });

             // Update TOC dynamically
            const tocItem = document.createElement('li');
            tocItem.classList.add('list-group-item', 'list-group-item-action');
            tocItem.style.cursor = 'pointer';
            tocItem.dataset.page = i;
            tocItem.textContent = `Page ${i}: ${pageAnalyses[i-1].summary}`;
            tocItem.addEventListener('click', () => showPage(i));
            tocList.appendChild(tocItem);

            // Update progress after successful processing of a page
            updateProgress(i, numPages, (i / numPages) * 100, `Page ${i} processed.`);

             // Optional: Add a small delay to avoid overwhelming the browser/API
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Processing complete
        updateProgress(numPages, numPages, 100, 'Processing complete!');
        statusMessageEl.textContent = '';
        processingProgress.style.display = 'none';
        resultsContainer.style.display = 'block';
        showPage(1); // Show the first page by default
     } catch (error) {
         console.error("Error during page processing:", error);
         statusMessageEl.textContent = `Error processing page ${currentPageNum}: ${error.message}. Stopping.`;
         alert(`An error occurred during processing: ${error.message}`);
         // Optionally show partially processed results or reset
          if (pageAnalyses.length > 0) {
            resultsContainer.style.display = 'block';
            showPage(1); // Show first available page
          } else {
            resetUI();
          }
     }
}


/**
 * Renders a specific PDF page to a high-resolution PNG image data URL.
 * @param {number} pageNum The page number to render.
 * @returns {Promise<string>} A promise that resolves with the image data URL.
 */
async function renderPageAsImage(pageNum) {
    try {
        const page = await pdfDoc.getPage(pageNum);
        const viewportBase = page.getViewport({ scale: 1.0 });
        const scale = DPI / 72; // Calculate scale for target DPI (standard PDF DPI is 72)
        const viewport = page.getViewport({ scale: scale });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };

        await page.render(renderContext).promise;
        return canvas.toDataURL('image/png'); // Use PNG for better quality
    } catch (error) {
        console.error(`Error rendering page ${pageNum}:`, error);
        throw new Error(`Failed to render page ${pageNum}: ${error.message}`); // Propagate error
    }
}

/**
 * Sends the page image to the LLM for analysis.
 * @param {string} imageDataUrl The data URL of the page image.
 * @param {number} pageNum The page number being analyzed.
 * @returns {Promise<string>} A promise that resolves with the LLM's analysis text.
 */
async function getLLMAnalysis(imageDataUrl, pageNum) {
    // --- LLM Integration Placeholder ---
    console.log(`Simulating LLM call for page ${pageNum}`);
    statusMessageEl.textContent = `Waiting for LLM analysis (page ${pageNum})...`;
    await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000)); // Simulate API call time

     const prompt = `Provide a detailed analysis of this PDF page image (Page ${pageNum}). Describe all visible content including text, tables, charts, images, headers, footers, and formatting. Identify the main subject matter, key points, data presented, and any notable elements. Extract relevant text where possible.`;

     try {
        const completion = await websim.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: "You are an expert document analyzer. Your task is to meticulously describe the content and structure of the provided PDF page image.",
                },
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        { type: "image_url", image_url: { url: imageDataUrl } },
                    ],
                },
            ],
             // Adjust parameters as needed
             // temperature: 0.2, // Factual response
             // max_tokens: 1800, // Allow longer response
        });
        statusMessageEl.textContent = `LLM analysis received for page ${pageNum}.`;
        return completion.content;
     } catch (error) {
        console.error(`LLM analysis failed for page ${pageNum}:`, error);
        statusMessageEl.textContent = `LLM analysis failed for page ${pageNum}: ${error.message}`;
        return `*Error analyzing page ${pageNum}: ${error.message}*`; // Return error message in analysis
     }
    // --- End Placeholder ---
}

/**
 * Generates a short summary for the Table of Contents using the LLM.
 * @param {string} fullAnalysis The full analysis text from the LLM.
 * @param {number} pageNum The page number.
 * @returns {Promise<string>} A promise that resolves with a short summary.
 */
async function getPageSummary(fullAnalysis, pageNum) {
    console.log(`Simulating LLM call for page ${pageNum} summary`);
    statusMessageEl.textContent = `Generating summary for page ${pageNum}...`;

    if (fullAnalysis.startsWith('*Error')) {
        return `Page ${pageNum} (Analysis Error)`;
    }

    try {
         const completion = await websim.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: "You are a summarization expert. Provide a very brief (5-10 words) summary or title for the following page analysis.",
                },
                {
                    role: "user",
                    content: `Summarize this analysis for a table of contents entry:\n\n${fullAnalysis.substring(0, 1000)}...` // Send only part of the analysis for summary
                },
            ],
             // Adjust parameters if needed (e.g., lower max_tokens for summary)
             // max_tokens: 50,
        });
        statusMessageEl.textContent = `Summary generated for page ${pageNum}.`;
        return completion.content.trim().replace(/\.$/, ''); // Remove trailing period if any
    } catch (error) {
        console.error(`LLM summary failed for page ${pageNum}:`, error);
        statusMessageEl.textContent = `LLM summary failed for page ${pageNum}: ${error.message}`;
        return `Page ${pageNum} (Summary Error)`;
    }
}


/**
 * Updates the display to show the specified page and its analysis.
 * @param {number} num The page number to display.
 */
function showPage(num) {
    if (!pdfDoc || num < 1 || num > pdfDoc.numPages || !pageAnalyses[num - 1]) {
        return; // Invalid page number or data not ready
    }
    currentPageNum = num;

    // Find the analysis data for the current page
    const pageData = pageAnalyses.find(p => p.pageNum === currentPageNum);

    if (!pageData) {
        console.error(`Data for page ${currentPageNum} not found.`);
        pageImage.src = ''; // Clear image
        analysisOutput.innerHTML = 'Error: Analysis data not available for this page.';
        return;
    }


    // Display image
    pageImage.src = pageData.imageDataUrl;
    pageImage.alt = `PDF Page ${currentPageNum}`;
     resetZoomBtn.click(); // Reset zoom when changing pages

    // Display analysis (potentially formatting Markdown later)
    analysisOutput.innerHTML = pageData.analysis.replace(/\n/g, '<br>'); // Simple newline conversion for now

    // Update UI elements
    currentPageDisplay.textContent = currentPageNum;
    jumpToPageInput.value = currentPageNum;


    // Update button states
    prevPageBtn.disabled = currentPageNum <= 1;
    nextPageBtn.disabled = currentPageNum >= pdfDoc.numPages;

    // Highlight active TOC item
    document.querySelectorAll('#toc-list li').forEach(li => {
        li.classList.remove('active');
        if (parseInt(li.dataset.page) === currentPageNum) {
            li.classList.add('active');
            li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });

    // Clear previous search highlights
    clearSearchHighlights();
}

function showPrevPage() {
    if (currentPageNum > 1) {
        showPage(currentPageNum - 1);
    }
}

function showNextPage() {
    if (pdfDoc && currentPageNum < pdfDoc.numPages) {
        showPage(currentPageNum + 1);
    }
}

function jumpToPage() {
    const pageNum = parseInt(jumpToPageInput.value);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= pdfDoc.numPages) {
        showPage(pageNum);
    } else {
        alert(`Please enter a valid page number between 1 and ${pdfDoc.numPages}.`);
        jumpToPageInput.value = currentPageNum; // Reset input to current page
    }
}

/**
 * Updates the progress bar and status message.
 * @param {number} current The current item being processed.
 * @param {number} total The total number of items.
 * @param {number} percentage The progress percentage.
 * @param {string} message The status message to display.
 */
function updateProgress(current, total, percentage, message) {
    currentPageEl.textContent = current;
    totalPagesEl.textContent = total;
    const clampedPercentage = Math.max(0, Math.min(100, percentage));
    progressBar.style.width = `${clampedPercentage}%`;
    progressBar.setAttribute('aria-valuenow', clampedPercentage);
    progressBar.textContent = `${Math.round(clampedPercentage)}%`;
     if (message) {
        statusMessageEl.textContent = message;
        console.log(message); // Also log progress
    }
}


/**
 * Zooms the PDF page image.
 * @param {number} factor Zoom factor (e.g., 1.2 for zoom in, 1/1.2 for zoom out).
 */
function zoomImage(factor) {
    currentScale *= factor;
    pageImage.style.transform = `scale(${currentScale})`;
     pageImage.style.cursor = currentScale > 1 ? 'zoom-out' : 'zoom-in';
}


/**
 * Performs a text search across all analysis results.
 */
function performSearch() {
    const query = searchInput.value.trim().toLowerCase();
    clearSearchHighlights(); // Clear previous highlights

    if (!query) {
        return; // No search term provided
    }

    const pageData = pageAnalyses.find(p => p.pageNum === currentPageNum);
    if (pageData) {
        highlightTextInNode(analysisOutput, query);
    }
}

/**
 * Clears previous search highlights from the analysis output.
 */
function clearSearchHighlights() {
    const highlights = analysisOutput.querySelectorAll('span.highlight');
    highlights.forEach(span => {
        // Replace the span with its text content
        const parent = span.parentNode;
        parent.replaceChild(document.createTextNode(span.textContent), span);
        parent.normalize(); // Merges adjacent text nodes
    });
}


/**
 * Highlights occurrences of a query string within a DOM node.
 * @param {Node} node The DOM node to search within.
 * @param {string} query The search query (lowercase).
 */
function highlightTextInNode(node, query) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null, false);
    let textNode;
    const nodesToProcess = [];

    // Collect all text nodes first to avoid issues with modifying the DOM while iterating
    while (textNode = walker.nextNode()) {
        nodesToProcess.push(textNode);
    }

    nodesToProcess.forEach(textNode => {
        const text = textNode.nodeValue.toLowerCase();
        let startIndex = 0;
        let index;

        while ((index = text.indexOf(query, startIndex)) > -1) {
            const match = textNode.nodeValue.substring(index, index + query.length);
            const highlightSpan = document.createElement('span');
            highlightSpan.className = 'highlight';
            highlightSpan.textContent = match;

            // Split the text node to insert the highlight span
            const textAfter = textNode.splitText(index); // Splits into textNode and textAfter
            textAfter.nodeValue = textAfter.nodeValue.substring(query.length); // Remove matched text from the second part
            textNode.parentNode.insertBefore(highlightSpan, textAfter); // Insert highlight before the second part

            // Continue searching in the remaining part of the text
            textNode = textAfter; // Update textNode to the part after the highlight
            startIndex = 0; // Reset start index for the new text node part
        }
    });
}


/**
 * Resets the UI to the initial upload state.
 */
function resetUI() {
    uploadContainer.style.display = 'block';
    processingProgress.style.display = 'none';
    resultsContainer.style.display = 'none';
    fileInfo.style.display = 'none';
    pdfUploadInput.value = ''; // Clear file input
    fileNameEl.textContent = '';
    fileSizeEl.textContent = '';
    pageCountEl.textContent = '';
    progressBar.style.width = '0%';
    progressBar.setAttribute('aria-valuenow', 0);
    progressBar.textContent = '0%';
    statusMessageEl.textContent = '';
    tocList.innerHTML = '';
    pageImage.src = '';
    analysisOutput.innerHTML = '';
    searchInput.value = '';
}


// --- Export Functions ---

function exportCurrentPageMarkdown() {
    const pageData = pageAnalyses.find(p => p.pageNum === currentPageNum);
    if (!pageData) return;

    const markdownContent = `## Page ${pageData.pageNum}\n\n**Analysis:**\n\n${pageData.analysis}\n`;
    downloadFile(markdownContent, `pdf_analysis_page_${pageData.pageNum}.md`, 'text/markdown');
}

function exportAllMarkdown() {
     if (pageAnalyses.length === 0) {
         alert("No analysis data to export.");
         return;
     }
    let fullMarkdown = `# PDF Analysis Report\n\n`;
    pageAnalyses.forEach(pageData => {
        fullMarkdown += `## Page ${pageData.pageNum}: ${pageData.summary}\n\n**Analysis:**\n\n${pageData.analysis}\n\n---\n\n`;
    });
     const pdfName = fileNameEl.textContent.replace('.pdf', '') || 'analysis';
    downloadFile(fullMarkdown, `${pdfName}_full_analysis.md`, 'text/markdown');
}

function downloadCurrentImage() {
     const pageData = pageAnalyses.find(p => p.pageNum === currentPageNum);
    if (!pageData || !pageData.imageDataUrl) return;

     const link = document.createElement('a');
     link.href = pageData.imageDataUrl;
      const pdfName = fileNameEl.textContent.replace('.pdf', '') || 'page';
     link.download = `${pdfName}_page_${pageData.pageNum}.png`;
     document.body.appendChild(link);
     link.click();
     document.body.removeChild(link);
}

/**
 * Helper function to trigger file download.
 * @param {string} content The file content.
 * @param {string} filename The desired filename.
 * @param {string} contentType The MIME type of the file.
 */
function downloadFile(content, filename, contentType) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --- Initial UI State ---
resetUI(); // Ensure UI starts clean
uploadContainer.style.display = 'block'; // Show upload initially


import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs';

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


// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// --- DOM Elements ---
const uploadContainer = document.getElementById('upload-container');
const uploadZone = document.getElementById('upload-zone');
const pdfUploadInput = document.getElementById('pdf-upload');
const fileInfo = document.getElementById('file-info');
const fileNameEl = document.getElementById('file-name');
const fileSizeEl = document.getElementById('file-size');
const pageCountEl = document.getElementById('page-count');
const processingProgress = document.getElementById('processing-progress');
const progressBar = document.getElementById('progress-bar');
const currentPageEl = document.getElementById('current-page');
const totalPagesEl = document.getElementById('total-pages');
const statusMessageEl = document.getElementById('status-message');

const resultsContainer = document.getElementById('results-container');
const tocList = document.getElementById('toc-list');
const tocCountEl = document.getElementById('toc-count');
const pdfViewer = document.getElementById('pdf-viewer');
const pageImage = document.getElementById('page-image');
const prevPageBtn = document.getElementById('prev-page');
const nextPageBtn = document.getElementById('next-page');
const currentPageDisplayImg = document.getElementById('current-page-display-img');
const totalPagesDisplayImg = document.getElementById('total-pages-display-img');
const jumpToPageInput = document.getElementById('jump-to-page-input');
const jumpToPageBtn = document.getElementById('jump-to-page-btn');
const analysisOutput = document.getElementById('analysis-output');
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const clearSearchButton = document.getElementById('clear-search-button');
const searchResultsSummary = document.getElementById('search-results-summary');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const resetZoomBtn = document.getElementById('reset-zoom');
const exportPageMdBtn = document.getElementById('export-page-md');
const exportAllMdBtn = document.getElementById('export-all-md');
const downloadPageImageBtn = document.getElementById('download-page-image');
const errorModalElement = document.getElementById('errorModal');
const errorModalBody = document.getElementById('errorModalBody');
const tocAccordionButton = document.querySelector('#tocAccordion button');
const tocCollapse = document.getElementById('collapseToc');

// Initialize Bootstrap components that need it
const errorModal = new bootstrap.Modal(errorModalElement);
const tocBsCollapse = new bootstrap.Collapse(tocCollapse, { toggle: false });

// --- State Variables ---
let pdfDoc = null;
let pdfFile = null; // Store the original file object
let currentPageNum = 1;
let pageAnalyses = []; // Array to store { pageNum: number, imageDataUrl: string | null, analysis: string | null, summary: string | null, error: string | null }
let currentScale = 1.0;
const MAX_FILE_SIZE_MB = 50;
const DPI = 150; // Adjusted DPI for balance between quality and performance/size
const LLM_TEMPERATURE = 0.2;
const LLM_MAX_TOKENS = 1800;
let currentSearchQuery = '';
let searchResultPages = []; // Store pages matching current search

// --- Event Listeners ---
uploadZone.addEventListener('click', () => pdfUploadInput.click());
pdfUploadInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) handleFileUpload(file);
});
uploadZone.addEventListener('dragover', (event) => { event.preventDefault(); event.stopPropagation(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', (event) => { event.preventDefault(); event.stopPropagation(); uploadZone.classList.remove('dragover'); });
uploadZone.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    uploadZone.classList.remove('dragover');
    const file = event.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') handleFileUpload(file);
    else showErrorModal('Please drop a PDF file.');
});
prevPageBtn.addEventListener('click', showPrevPage);
nextPageBtn.addEventListener('click', showNextPage);
jumpToPageBtn.addEventListener('click', jumpToPage);
jumpToPageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') jumpToPage(); });
searchButton.addEventListener('click', performSearch);
searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') performSearch(); });
clearSearchButton.addEventListener('click', clearSearch);
zoomInBtn.addEventListener('click', () => zoomImage(1.2));
zoomOutBtn.addEventListener('click', () => zoomImage(1 / 1.2));
resetZoomBtn.addEventListener('click', () => { currentScale = 1.0; pageImage.style.transform = `scale(${currentScale})`; pageImage.style.cursor = 'zoom-in'; });
pageImage.addEventListener('click', () => { if(pageImage.src) zoomImage(1.5) }); // Zoom in on click if image is loaded
exportPageMdBtn.addEventListener('click', exportCurrentPageMarkdown);
exportAllMdBtn.addEventListener('click', exportAllMarkdown);
downloadPageImageBtn.addEventListener('click', downloadCurrentImage);

// --- Functions ---

function showErrorModal(message) {
    console.error("Error:", message);
    errorModalBody.textContent = message;
    errorModal.show();
}

/** Handles the uploaded PDF file. */
async function handleFileUpload(file) {
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        showErrorModal(`File size (${(file.size / 1024 / 1024).toFixed(2)} MB) exceeds the limit of ${MAX_FILE_SIZE_MB}MB.`);
        return;
    }

    resetUIBeforeUpload();
    pdfFile = file; // Store file reference

    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB`;

    updateProgress(0, 0, 0, 'Reading PDF...');

    const fileReader = new FileReader();
    fileReader.onload = async function() {
        const typedarray = new Uint8Array(this.result);
        try {
            const loadingTask = pdfjsLib.getDocument({ data: typedarray });
            pdfDoc = await loadingTask.promise;

            const numPages = pdfDoc.numPages;
            pageCountEl.textContent = numPages;
            totalPagesEl.textContent = numPages;
            totalPagesDisplayImg.textContent = numPages;
            jumpToPageInput.max = numPages;
            tocCountEl.textContent = numPages;

            // Initialize pageAnalyses array
            pageAnalyses = Array.from({ length: numPages }, (_, i) => ({
                pageNum: i + 1,
                imageDataUrl: null,
                analysis: null,
                summary: null,
                error: null
            }));

            // Start processing pages using requestIdleCallback for better responsiveness
            processQueue(1); // Start queue with page 1

        } catch (error) {
            console.error("Error loading PDF:", error);
            showErrorModal(`Error loading PDF: ${error.message || error}`);
            resetUI();
        }
    };
    fileReader.onerror = (e) => {
         console.error("FileReader error:", e);
         showErrorModal("Error reading the PDF file.");
         resetUI();
    };
    fileReader.readAsArrayBuffer(file);
}


/** Processes the PDF page queue using requestIdleCallback. */
function processQueue(pageIndex) {
    if (!pdfDoc || pageIndex > pdfDoc.numPages) {
        processingFinished();
        return; // All pages processed or error occurred
    }

    requestIdleCallback(async (deadline) => {
         let currentTime = performance.now();
         let pageNum = pageIndex;

         // Process as many pages as possible within the deadline (or at least one)
         while ((deadline.timeRemaining() > 0 || deadline.didTimeout) && pageNum <= pdfDoc.numPages) {
             currentTime = performance.now(); // Update time before processing next page
             updateProgress(pageNum -1, pdfDoc.numPages, ((pageNum - 1) / pdfDoc.numPages) * 100, `Queueing page ${pageNum}...`);

            try {
                 await processSinglePage(pageNum);
                 updateProgress(pageNum, pdfDoc.numPages, (pageNum / pdfDoc.numPages) * 100, `Page ${pageNum} analysis complete.`);

                 // Update TOC dynamically
                updateTocItem(pageNum);

                 // Show first page as soon as it's rendered & analyzed (optional)
                if (pageNum === 1) {
                    resultsContainer.style.display = 'block';
                    tocBsCollapse.show(); // Show TOC by default initially
                    showPage(1);
                 }

            } catch(pageError) {
                 console.error(`Error processing page ${pageNum}:`, pageError);
                 pageAnalyses[pageNum - 1].error = pageError.message || pageError;
                 updateProgress(pageNum, pdfDoc.numPages, (pageNum / pdfDoc.numPages) * 100, `Error on page ${pageNum}. Skipping.`);
                 updateTocItem(pageNum); // Update TOC to show error status
            }

             pageNum++; // Move to the next page
             // Check time again after processing a page
             if(performance.now() - currentTime > 40) break; // Prevent freezing if one page takes long
         }

         // Schedule the next batch
         if (pageNum <= pdfDoc.numPages) {
             processQueue(pageNum);
         } else {
             processingFinished();
         }
    }, { timeout: 1000 }); // Timeout ensures it runs even if browser is busy
}

/** Actions to perform when all pages are processed or queue ends. */
function processingFinished() {
    if (!pdfDoc) return; // Might have been reset due to error
    updateProgress(pdfDoc.numPages, pdfDoc.numPages, 100, 'All pages processed!');
    statusMessageEl.textContent = 'Analysis complete.';
    setTimeout(() => { // Hide progress bar after a short delay
        processingProgress.style.display = 'none';
        statusMessageEl.textContent = '';
    }, 1500);
     if (!resultsContainer.style.display || resultsContainer.style.display === 'none') {
         resultsContainer.style.display = 'block';
         showPage(1); // Ensure first page is shown if not already
     }
     tocBsCollapse.show(); // Ensure TOC is expanded when done
}


/** Processes a single page: renders image, gets LLM analysis & summary. */
async function processSinglePage(pageNum) {
    const pageData = pageAnalyses[pageNum - 1];
    if (pageData.analysis !== null || pageData.error) return; // Already processed or failed

    // 1. Render Image
    statusMessageEl.textContent = `Rendering page ${pageNum}...`;
    try {
        pageData.imageDataUrl = await renderPageAsImage(pageNum);
    } catch (renderError) {
        console.error(`Rendering failed for page ${pageNum}:`, renderError);
        pageData.error = `Image rendering failed: ${renderError.message}`;
        pageData.imageDataUrl = null; // Ensure no broken image link
        throw renderError; // Propagate to stop analysis for this page
    }


    // 2. Get LLM Analysis
    statusMessageEl.textContent = `Analyzing page ${pageNum} with LLM...`;
    try {
        pageData.analysis = await getLLMAnalysis(pageData.imageDataUrl, pageNum);
    } catch (llmError) {
        console.error(`LLM analysis failed for page ${pageNum}:`, llmError);
        pageData.analysis = `*LLM analysis failed: ${llmError.message}*`;
        // Don't set pageData.error here, we still want to try summarizing if possible
    }

    // 3. Get Summary (even if analysis failed, maybe provide a basic summary)
    statusMessageEl.textContent = `Summarizing page ${pageNum}...`;
    try {
        pageData.summary = await getPageSummary(pageData.analysis || `Page ${pageNum} - Analysis Error`, pageNum);
    } catch (summaryError) {
         console.error(`LLM summary failed for page ${pageNum}:`, summaryError);
         pageData.summary = `Page ${pageNum} (Summary Error)`;
         // Don't set pageData.error here unless it's the first error
         if (!pageData.analysis?.includes('failed')) {
             pageData.analysis += `\n\n*Summary generation failed: ${summaryError.message}*`;
         }
    }

     statusMessageEl.textContent = `Page ${pageNum} processed.`;
}

/** Updates or creates a TOC list item. */
function updateTocItem(pageNum) {
    const pageData = pageAnalyses[pageNum - 1];
    let tocItem = tocList.querySelector(`li[data-page="${pageNum}"]`);

    if (!tocItem) {
        tocItem = document.createElement('li');
        tocItem.classList.add('list-group-item', 'list-group-item-action');
        tocItem.style.cursor = 'pointer';
        tocItem.dataset.page = pageNum;
        tocItem.addEventListener('click', () => showPage(pageNum));

        // Try to insert in correct order
        const nextPageItem = tocList.querySelector(`li[data-page="${pageNum + 1}"]`);
        if (nextPageItem) {
            tocList.insertBefore(tocItem, nextPageItem);
        } else {
            tocList.appendChild(tocItem);
        }
    }

    let summaryText = `Page ${pageNum}: ${pageData.summary || 'Processing...'}`;
    if (pageData.error) {
        summaryText = `<span class="text-danger">Page ${pageNum}: Error (${pageData.error.substring(0,30)}...)</span>`;
        tocItem.title = pageData.error; // Show full error on hover
        tocItem.classList.add('list-group-item-danger');
    } else if (pageData.analysis && pageData.analysis.includes('failed')) {
         summaryText = `<span class="text-warning">Page ${pageNum}: ${pageData.summary || 'Analysis Failed'}</span>`;
         tocItem.classList.add('list-group-item-warning');
    }
     else {
         tocItem.classList.remove('list-group-item-danger', 'list-group-item-warning');
         tocItem.title = pageData.summary || '';
    }


    tocItem.innerHTML = summaryText;

    // Highlight if it's a search result
    if (currentSearchQuery && searchResultPages.includes(pageNum)) {
         tocItem.classList.add('bg-warning'); // Or another highlight class
    } else {
        tocItem.classList.remove('bg-warning');
    }

    // Re-apply active class if it's the currently viewed page
     if (pageNum === currentPageNum) {
         tocItem.classList.add('active');
     }
}


/** Renders a PDF page to PNG data URL. */
async function renderPageAsImage(pageNum) {
    const page = await pdfDoc.getPage(pageNum);
    const viewportBase = page.getViewport({ scale: 1.0 });
    const scale = DPI / 72;
    const viewport = page.getViewport({ scale: scale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = Math.floor(viewport.height); // Use integers for canvas dimensions
    canvas.width = Math.floor(viewport.width);
    context.imageSmoothingEnabled = true; // Enable smoothing
    context.imageSmoothingQuality = 'high';

    // Optional: Render white background first if PDF has transparency
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);


    const renderContext = {
        canvasContext: context,
        viewport: viewport
    };

    await page.render(renderContext).promise;
    return canvas.toDataURL('image/png', 0.9); // Use PNG with slight compression
}

/** Sends image to LLM for analysis. */
async function getLLMAnalysis(imageDataUrl, pageNum) {
    if (!imageDataUrl) throw new Error("No image data provided for analysis.");

    const prompt = `Provide a detailed analysis of this PDF page image (Page ${pageNum} of the document). Describe all visible content including text (extract key text snippets), tables (summarize data or structure), charts (describe type and data shown), images (describe content), headers, footers, and overall formatting/layout. Identify the main subject matter, key points, data presented, and any notable visual elements. Structure your response clearly using markdown.`;

    try {
        const completion = await websim.chat.completions.create({
            messages: [
                { role: "system", content: "You are an expert document analyzer. Your task is to meticulously describe the content and structure of the provided PDF page image. Use Markdown for formatting." },
                { role: "user", content: [
                        { type: "text", text: prompt },
                        { type: "image_url", image_url: { url: imageDataUrl } },
                    ]
                },
            ],
            temperature: LLM_TEMPERATURE,
            max_tokens: LLM_MAX_TOKENS,
        });
        return completion.content;
    } catch (error) {
        console.error(`LLM analysis error (Page ${pageNum}):`, error);
        throw new Error(`LLM API call failed: ${error.message || error}`);
    }
}

/** Gets a short summary for TOC using LLM. */
async function getPageSummary(fullAnalysis, pageNum) {
     const summaryPrompt = `Provide a very brief (max 10 words) title or topic summary for the following page analysis content. Focus on the main subject. Example: "Introduction Chapter", "Sales Data Table", "Architectural Diagram".\n\nAnalysis Content:\n${fullAnalysis.substring(0, 1500)}...`; // Limit input for summary

    try {
        const completion = await websim.chat.completions.create({
            messages: [
                { role: "system", content: "You create concise titles/summaries (max 10 words) based on text content." },
                { role: "user", content: summaryPrompt },
            ],
            temperature: 0.5, // Slightly more creative for summary
            max_tokens: 60,
        });
        return completion.content.trim().replace(/["'.]/g, ''); // Clean up summary
    } catch (error) {
        console.error(`LLM summary error (Page ${pageNum}):`, error);
        throw new Error(`LLM summary failed: ${error.message || error}`);
    }
}

/** Displays the specified page and its analysis. */
function showPage(num) {
    if (!pdfDoc || num < 1 || num > pdfDoc.numPages || !pageAnalyses || pageAnalyses.length < num) {
         console.warn(`Attempted to show invalid page: ${num}`);
        return; // Invalid page number or data not ready
    }
    currentPageNum = num;
    const pageData = pageAnalyses[currentPageNum - 1];

    // Display image (use cached or render on demand if failed initially)
     if (pageData.imageDataUrl) {
        pageImage.src = pageData.imageDataUrl;
        pageImage.alt = `PDF Page ${currentPageNum}`;
        downloadPageImageBtn.disabled = false;
        zoomInBtn.disabled = false;
        zoomOutBtn.disabled = false;
        resetZoomBtn.disabled = false;
     } else {
         // Handle case where image rendering failed or hasn't happened
         pageImage.src = '';
         pageImage.alt = `Image rendering failed for page ${currentPageNum}`;
         downloadPageImageBtn.disabled = true;
         zoomInBtn.disabled = true;
         zoomOutBtn.disabled = true;
         resetZoomBtn.disabled = true;
          // Optionally, try rendering again here if needed
          console.warn(`Image data missing for page ${currentPageNum}. Error: ${pageData.error}`);
     }
     resetZoomBtn.click(); // Reset zoom

    // Display analysis
    analysisOutput.innerHTML = ''; // Clear previous
    if (pageData.analysis) {
        // Basic Markdown-like rendering (could be improved with a library)
        const formattedAnalysis = pageData.analysis
            .replace(/^### (.*$)/gim, '<h5>$1</h5>')
            .replace(/^## (.*$)/gim, '<h4>$1</h4>')
            .replace(/^# (.*$)/gim, '<h3>$1</h3>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
            .replace(/\*(.*?)\*/g, '<em>$1</em>')     // Italics
            .replace(/`([^`]+)`/g, '<code>$1</code>') // Inline code
             // Handle lists (simple approach)
            .replace(/^\* (.*$)/gim, '<li>$1</li>')
            .replace(/^\d+\. (.*$)/gim, '<li>$1</li>')
            .replace(/(<li>.*<\/li>\s*)+/g, match => `<ul>${match}</ul>`) // Wrap adjacent list items
            // .replace(/\n/g, '<br>'); // Keep pre-wrap for better newline handling

        analysisOutput.innerHTML = formattedAnalysis; // Use innerHTML as we generated HTML tags
        exportPageMdBtn.disabled = false;

         // Re-apply search highlighting if needed
        if (currentSearchQuery) {
             highlightTextInNode(analysisOutput, currentSearchQuery);
        }

    } else if (pageData.error) {
        analysisOutput.innerHTML = `<p class="text-danger"><strong>Error processing page ${currentPageNum}:</strong><br>${pageData.error}</p>`;
         exportPageMdBtn.disabled = true;
    } else {
        analysisOutput.textContent = 'Analysis is processing or was skipped...';
         exportPageMdBtn.disabled = true;
    }


    // Update UI elements
    currentPageDisplayImg.textContent = currentPageNum;
    jumpToPageInput.value = currentPageNum;
    prevPageBtn.disabled = currentPageNum <= 1;
    nextPageBtn.disabled = currentPageNum >= pdfDoc.numPages;

    // Update active TOC item
    document.querySelectorAll('#toc-list li').forEach(li => {
        li.classList.remove('active');
        if (parseInt(li.dataset.page) === currentPageNum) {
            li.classList.add('active');
            // Scroll TOC item into view only if the TOC is visible
            if (!tocCollapse.classList.contains('show')) {
                tocBsCollapse.show(); // Ensure TOC is visible if navigating via buttons
                // Need a slight delay for the collapse animation to finish before scrolling
                 setTimeout(() => {
                     li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                 }, 350);
            } else {
                 li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }

        }
    });
}

function showPrevPage() { if (currentPageNum > 1) showPage(currentPageNum - 1); }
function showNextPage() { if (pdfDoc && currentPageNum < pdfDoc.numPages) showPage(currentPageNum + 1); }
function jumpToPage() {
    const pageNum = parseInt(jumpToPageInput.value);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= pdfDoc.numPages) {
        showPage(pageNum);
    } else {
        showErrorModal(`Please enter a valid page number between 1 and ${pdfDoc.numPages}.`);
        jumpToPageInput.value = currentPageNum;
    }
}

/** Updates the progress bar and status message. */
function updateProgress(current, total, percentage, message) {
    if (total > 0) {
        currentPageEl.textContent = Math.min(current, total); // Don't exceed total
        totalPagesEl.textContent = total;
        const clampedPercentage = Math.max(0, Math.min(100, percentage));
        progressBar.style.width = `${clampedPercentage}%`;
        progressBar.setAttribute('aria-valuenow', clampedPercentage);
        progressBar.textContent = `${Math.round(clampedPercentage)}%`;
    } else {
         progressBar.style.width = `0%`;
         progressBar.setAttribute('aria-valuenow', 0);
         progressBar.textContent = `0%`;
    }

     if (message) {
        statusMessageEl.textContent = message;
    }
}

/** Zooms the PDF page image. */
function zoomImage(factor) {
    currentScale *= factor;
    // Add limits to zoom scale if desired
    // currentScale = Math.max(0.2, Math.min(currentScale, 5.0));
    pageImage.style.transform = `scale(${currentScale})`;
    pageImage.style.cursor = currentScale > 1 ? 'zoom-out' : 'zoom-in';
}


/** Performs a text search across all analysis results. */
function performSearch() {
    const query = searchInput.value.trim().toLowerCase();
    clearSearchHighlights(false); // Clear previous visual highlights only

    if (!query) {
        currentSearchQuery = '';
        searchResultPages = [];
        searchResultsSummary.style.display = 'none';
        // Clear TOC highlights
         document.querySelectorAll('#toc-list li.bg-warning').forEach(li => li.classList.remove('bg-warning'));
        return; // No search term provided
    }

    currentSearchQuery = query;
    searchResultPages = [];
    let totalMatches = 0;

    pageAnalyses.forEach(pageData => {
        if (pageData.analysis && pageData.analysis.toLowerCase().includes(query)) {
            searchResultPages.push(pageData.pageNum);
            // Count matches on the page (simple count, might not be accurate for overlapping)
             const matchesOnPage = (pageData.analysis.toLowerCase().match(new RegExp(query, 'g')) || []).length;
             totalMatches += matchesOnPage;
        }
        // Update TOC highlighting for this page
        updateTocItem(pageData.pageNum);
    });

    // Display summary
    if (searchResultPages.length > 0) {
        searchResultsSummary.textContent = `Found ${totalMatches} match(es) on ${searchResultPages.length} page(s). Use TOC highlighting or Prev/Next Result buttons.`; // Add buttons later if needed
        searchResultsSummary.style.display = 'block';
         // Highlight current page if it's a result
         if (searchResultPages.includes(currentPageNum)) {
             highlightTextInNode(analysisOutput, currentSearchQuery);
         }
         // Optionally jump to the first result page automatically
         // if (!searchResultPages.includes(currentPageNum)) {
         //     showPage(searchResultPages[0]);
         // }
         tocBsCollapse.show(); // Ensure TOC is visible to see highlights

    } else {
        searchResultsSummary.textContent = `No matches found for "${searchInput.value}".`;
        searchResultsSummary.style.display = 'block';
    }

    // Enable clear button
    clearSearchButton.disabled = false;
}

/** Clears search state and highlights. */
function clearSearch() {
    searchInput.value = '';
    currentSearchQuery = '';
    searchResultPages = [];
    searchResultsSummary.style.display = 'none';
    clearSearchHighlights(true); // Clear visual highlights
    clearSearchButton.disabled = true;
     // Clear TOC highlights
    document.querySelectorAll('#toc-list li.bg-warning').forEach(li => li.classList.remove('bg-warning'));
}


/** Clears search highlights from the analysis output. */
function clearSearchHighlights(resetSearchState = true) {
    // Only clear visual highlights if needed
     const highlights = analysisOutput.querySelectorAll('span.highlight');
     highlights.forEach(span => {
        const parent = span.parentNode;
        if (parent) { // Check if parent exists
             // Replace span with its text content ONLY IF the span is still in the DOM
            try {
                 parent.replaceChild(document.createTextNode(span.textContent), span);
                 parent.normalize(); // Merges adjacent text nodes
            } catch (e) {
                 console.warn("Could not replace highlight span, likely already removed.");
            }
        }
    });

    if (resetSearchState) {
        currentSearchQuery = '';
        searchResultPages = [];
         searchResultsSummary.style.display = 'none';
         clearSearchButton.disabled = true;
          // Also clear TOC highlights
         document.querySelectorAll('#toc-list li.bg-warning').forEach(li => li.classList.remove('bg-warning'));
    }
}

/** Highlights text in a DOM node (more robust). */
function highlightTextInNode(node, query) {
    const treeWalker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
            // Skip nodes within script/style tags or already highlighted spans
            if (node.parentElement.tagName === 'SCRIPT' ||
                node.parentElement.tagName === 'STYLE' ||
                node.parentElement.classList.contains('highlight')) {
                return NodeFilter.FILTER_REJECT;
            }
            // Check if the node's text content contains the query (case-insensitive)
            if (node.nodeValue.toLowerCase().includes(query)) {
                return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_SKIP;
        }
    }, false);

    const nodesToHighlight = [];
    while (treeWalker.nextNode()) {
        nodesToHighlight.push(treeWalker.currentNode);
    }

    nodesToHighlight.forEach(textNode => {
        const text = textNode.nodeValue;
        const lcText = text.toLowerCase();
        let startIndex = 0;
        let index;
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;

        while ((index = lcText.indexOf(query, startIndex)) > -1) {
            // Add text before the match
            fragment.appendChild(document.createTextNode(text.substring(lastIndex, index)));

            // Add the highlighted match
            const match = text.substring(index, index + query.length);
            const highlightSpan = document.createElement('span');
            highlightSpan.className = 'highlight';
            highlightSpan.textContent = match;
            fragment.appendChild(highlightSpan);

            lastIndex = index + query.length;
            startIndex = lastIndex; // Continue search after the match
        }

        // Add any remaining text after the last match
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));

        // Replace the original text node with the fragment containing highlights
         if (textNode.parentNode) { // Ensure node is still attached
            textNode.parentNode.replaceChild(fragment, textNode);
         }
    });
}


/** Resets the UI before a new upload starts. */
function resetUIBeforeUpload() {
    // Keep upload zone visible until PDF loaded
    processingProgress.style.display = 'block'; // Show progress bar immediately
    resultsContainer.style.display = 'none';
    fileInfo.style.display = 'block'; // Show file info area
    pdfUploadInput.value = ''; // Clear file input selection visually
    fileNameEl.textContent = '...';
    fileSizeEl.textContent = '...';
    pageCountEl.textContent = '...';
    progressBar.style.width = '0%';
    progressBar.setAttribute('aria-valuenow', 0);
    progressBar.textContent = '0%';
    statusMessageEl.textContent = 'Initiating upload...';
    tocList.innerHTML = ''; // Clear old TOC
    tocCountEl.textContent = '0';
    pageImage.src = '';
    pageImage.alt = 'PDF Page';
    analysisOutput.innerHTML = '';
    clearSearch(); // Reset search state
     pdfDoc = null; // Clear previous PDF document object
     pdfFile = null;
     currentPageNum = 1;
     pageAnalyses = [];
     currentScale = 1.0;
     pageImage.style.transform = `scale(${currentScale})`;
     // Disable buttons until content loads
     prevPageBtn.disabled = true;
     nextPageBtn.disabled = true;
     jumpToPageBtn.disabled = true;
     jumpToPageInput.disabled = true;
     zoomInBtn.disabled = true;
     zoomOutBtn.disabled = true;
     resetZoomBtn.disabled = true;
     exportPageMdBtn.disabled = true;
     exportAllMdBtn.disabled = true;
     downloadPageImageBtn.disabled = true;
     clearSearchButton.disabled = true;
}

/** Resets the UI completely to the initial state. */
function resetUI() {
    resetUIBeforeUpload(); // Do most of the resetting
    uploadContainer.style.display = 'block'; // Show upload zone
    processingProgress.style.display = 'none'; // Hide progress
    fileInfo.style.display = 'none'; // Hide file info
    resultsContainer.style.display = 'none'; // Hide results
    analysisOutput.textContent = 'Upload a PDF to begin analysis.'; // Reset placeholder
}


// --- Export Functions ---

function exportCurrentPageMarkdown() {
    if (!pageAnalyses || pageAnalyses.length < currentPageNum) return;
    const pageData = pageAnalyses[currentPageNum - 1];
    if (!pageData || !pageData.analysis) {
        showErrorModal("Analysis data for the current page is not available.");
        return;
    }

    const markdownContent = `## Page ${pageData.pageNum} Analysis (${fileNameEl.textContent})\n\n${pageData.analysis}\n`;
    const safeFileName = (pdfFile?.name || 'pdf_analysis').replace('.pdf', '');
    downloadFile(markdownContent, `${safeFileName}_page_${pageData.pageNum}.md`, 'text/markdown;charset=utf-8');
}

function exportAllMarkdown() {
     if (!pageAnalyses || pageAnalyses.length === 0) {
         showErrorModal("No analysis data available to export.");
         return;
     }
    let fullMarkdown = `# PDF Analysis Report: ${fileNameEl.textContent}\n\n`;
    let pagesWithErrors = [];
    let pagesProcessed = 0;

    pageAnalyses.forEach(pageData => {
        fullMarkdown += `## Page ${pageData.pageNum}: ${pageData.summary || 'N/A'}\n\n`;
        if (pageData.analysis) {
            fullMarkdown += `${pageData.analysis}\n\n`;
            pagesProcessed++;
        } else if (pageData.error) {
            fullMarkdown += `*Error processing this page: ${pageData.error}*\n\n`;
            pagesWithErrors.push(pageData.pageNum);
        } else {
             fullMarkdown += `*Analysis not available for this page.*\n\n`;
        }
        fullMarkdown += `---\n\n`;
    });

    if (pagesWithErrors.length > 0) {
        fullMarkdown += `**Note:** Errors occurred during analysis for page(s): ${pagesWithErrors.join(', ')}.\n`;
    }
     if (pagesProcessed === 0) {
         showErrorModal("No pages were successfully analyzed to export.");
         return;
     }

    const safeFileName = (pdfFile?.name || 'pdf_analysis').replace('.pdf', '');
    downloadFile(fullMarkdown, `${safeFileName}_full_analysis.md`, 'text/markdown;charset=utf-8');
}

function downloadCurrentImage() {
     if (!pageAnalyses || pageAnalyses.length < currentPageNum) return;
     const pageData = pageAnalyses[currentPageNum - 1];
    if (!pageData || !pageData.imageDataUrl) {
        showErrorModal("Image for the current page is not available for download.");
        return;
    }

     const link = document.createElement('a');
     link.href = pageData.imageDataUrl;
     const safeFileName = (pdfFile?.name || 'page').replace('.pdf', '');
     link.download = `${safeFileName}_page_${pageData.pageNum}.png`;
     document.body.appendChild(link);
     link.click();
     document.body.removeChild(link);
}

/** Helper function to trigger file download. */
function downloadFile(content, filename, contentType) {
    try {
        const blob = new Blob([content], { type: contentType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
         console.error("Download failed:", e);
         showErrorModal(`Failed to initiate download: ${e.message}`);
    }
}

// --- Initial UI State ---
resetUI(); // Ensure UI starts clean



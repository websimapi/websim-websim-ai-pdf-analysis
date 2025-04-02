import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker source using the path from the import map
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.min.mjs';

// --- Polyfill for requestIdleCallback ---
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

// --- DOM Elements ---
const uploadContainer = document.getElementById('upload-container');
const uploadZone = document.getElementById('upload-zone');
const pdfUpload = document.getElementById('pdf-upload');
const fileInfo = document.getElementById('file-info');
const fileNameSpan = document.getElementById('file-name');
const fileSizeSpan = document.getElementById('file-size');
const pageCountSpan = document.getElementById('page-count');
const processingProgress = document.getElementById('processing-progress');
const progressBar = document.getElementById('progress-bar');
const currentPageSpan = document.getElementById('current-page');
const totalPagesSpan = document.getElementById('total-pages');
const statusMessage = document.getElementById('status-message');
const resultsContainer = document.getElementById('results-container');
const tocList = document.getElementById('toc-list');
const tocCountSpan = document.getElementById('toc-count');
const pdfViewer = document.getElementById('pdf-viewer');
const pageImage = document.getElementById('page-image');
const prevPageBtn = document.getElementById('prev-page');
const nextPageBtn = document.getElementById('next-page');
const currentPageDisplayImg = document.getElementById('current-page-display-img');
const totalPagesDisplayImg = document.getElementById('total-pages-display-img');
const jumpToPageInput = document.getElementById('jump-to-page-input');
const jumpToPageBtn = document.getElementById('jump-to-page-btn');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const resetZoomBtn = document.getElementById('reset-zoom');
const analysisOutput = document.getElementById('analysis-output');
const exportPageMdBtn = document.getElementById('export-page-md');
const exportAllMdBtn = document.getElementById('export-all-md');
const downloadPageImageBtn = document.getElementById('download-page-image');
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const clearSearchButton = document.getElementById('clear-search-button');
const searchResultsSummary = document.getElementById('search-results-summary');
const errorModalElement = document.getElementById('errorModal'); // Get the element first
const errorModalBody = document.getElementById('errorModalBody');
let errorModal; // Initialize later

// --- State ---
let pdfDoc = null;
let currentPageNum = 1;
let totalPages = 0;
let pageAnalyses = {}; // Store analysis results { pageNum: analysisText }
let pageImageCache = {}; // Store rendered page images { pageNum: dataUrl }
let currentZoom = 1.0;
const MAX_FILE_SIZE_MB = 50;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
let processingQueue = [];
let isProcessing = false;
let currentRenderTask = null;
let currentAnalysisTask = null; // Track the current LLM call

// --- Error Handling ---
function showErrorModal(message) {
    console.error("Error:", message);
    if (errorModal) { // Check if modal is initialized
        errorModalBody.textContent = message;
        errorModal.show();
    } else {
        // Fallback if modal initialization failed somehow
        alert(`Error: ${message}`);
    }
    // Optionally reset UI state
    resetUI();
}

// --- UI Updates ---
function updateProgressBar(value) {
    const percent = Math.min(100, Math.max(0, value));
    progressBar.style.width = `${percent}%`;
    progressBar.textContent = `${Math.round(percent)}%`;
    progressBar.setAttribute('aria-valuenow', percent);
}

function updateStatus(page, total, message = "") {
    currentPageSpan.textContent = page;
    totalPagesSpan.textContent = total;
    statusMessage.textContent = message;
}

function displayFileInfo(file) {
    fileNameSpan.textContent = file.name;
    fileSizeSpan.textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB`;
    fileInfo.style.display = 'block';
}

function showProcessing() {
    uploadContainer.style.display = 'none';
    processingProgress.style.display = 'block';
    resultsContainer.style.display = 'none';
    updateProgressBar(0);
    updateStatus(0, 0, "Initializing...");
}

function showResults() {
    uploadContainer.style.display = 'none';
    processingProgress.style.display = 'none';
    resultsContainer.style.display = 'block';
    updateNavigation();
}

function resetUI() {
    uploadContainer.style.display = 'block';
    processingProgress.style.display = 'none';
    resultsContainer.style.display = 'none';
    fileInfo.style.display = 'none';
    pdfUpload.value = ''; // Clear the file input
    pdfDoc = null;
    currentPageNum = 1;
    totalPages = 0;
    pageAnalyses = {};
    pageImageCache = {};
    processingQueue = [];
    isProcessing = false;
    tocList.innerHTML = '';
    tocCountSpan.textContent = '0';
    analysisOutput.textContent = 'Upload a PDF to begin analysis.';
    pageImage.src = '';
    resetZoom();
    if (currentRenderTask) {
        currentRenderTask.cancel();
        currentRenderTask = null;
    }
    // We can't easily cancel the LLM call itself, but we can stop processing the result
    currentAnalysisTask = null; // Indicate no active analysis needed
    clearSearchHighlights(); // Clear search results on reset
    searchResultsSummary.style.display = 'none';
    searchInput.value = '';
}

// --- PDF Rendering ---
async function renderPage(pageNum) {
    if (!pdfDoc || pageNum < 1 || pageNum > totalPages) return;

     // Cancel previous render task if it exists
    if (currentRenderTask) {
        console.log("Cancelling previous render task");
        currentRenderTask.cancel();
    }


    pageImage.style.opacity = '0.5'; // Indicate loading
    pageImage.src = ''; // Clear previous image immediately

    try {
        // Check cache first
        if (pageImageCache[pageNum]) {
            pageImage.src = pageImageCache[pageNum];
            pageImage.style.opacity = '1';
            console.log(`Page ${pageNum} loaded from cache.`);
            updateNavigation();
            displayAnalysis(pageNum);
            highlightSearchTerms(); // Re-apply highlights if searching
            return; // Exit early if cached
        }

        statusMessage.textContent = `Rendering page ${pageNum}...`;
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 }); // Adjust scale for quality/performance trade-off
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
            canvasContext: context,
            viewport: viewport,
            renderInteractiveForms: true, // Enable rendering of form elements
        };

        currentRenderTask = page.render(renderContext);


        await currentRenderTask.promise;
        currentRenderTask = null; // Clear task after completion

        const imageDataUrl = canvas.toDataURL('image/png'); // Use PNG for better quality
        pageImageCache[pageNum] = imageDataUrl; // Cache the rendered image
        pageImage.src = imageDataUrl;
        pageImage.style.opacity = '1';
        updateNavigation();
        displayAnalysis(pageNum);
        highlightSearchTerms(); // Re-apply highlights if searching
        statusMessage.textContent = `Page ${pageNum} rendered.`;


    } catch (error) {
         currentRenderTask = null; // Clear task on error
        if (error.name === 'RenderingCancelledException' || (error.message && error.message.includes("cancelled"))) {
            console.log(`Rendering cancelled for page ${pageNum}`);
            statusMessage.textContent = `Rendering stopped.`;

        } else {
            console.error(`Error rendering page ${pageNum}:`, error);
            showErrorModal(`Failed to render page ${pageNum}. The page might be corrupted or too complex. (${error.message || error})`);
            pageImage.alt = `Error rendering page ${pageNum}`;
            pageImage.src = ''; // Clear image on error
            pageImage.style.opacity = '1';
             // Attempt to proceed or stop? Maybe stop processing here?
             // For now, just show error and let user navigate manually
        }
    } finally {
         pageImage.style.opacity = '1'; // Ensure opacity is reset even on error/cancellation
    }
}

// --- LLM Analysis ---
async function analyzePage(pageNum, imageDataUrl) {
     if (!imageDataUrl) {
        console.warn(`Skipping analysis for page ${pageNum}: no image data.`);
        return; // Don't proceed without image data
    }

    // Store the current page number being analyzed
    currentAnalysisTask = pageNum;

    try {
        statusMessage.textContent = `Analyzing page ${pageNum} with AI...`;
        const completion = await websim.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are an expert document analyzer. Analyze the provided image of a PDF page.
                    Describe ALL visible content including:
                    - Text content (try to extract key sentences or paragraphs).
                    - Tables (describe structure and summarize data).
                    - Charts/Graphs (identify type and describe data shown).
                    - Images (briefly describe).
                    - Headers/Footers/Page Numbers.
                    - Overall layout and formatting elements.
                    Identify the main subject matter, key points, data presented, and any notable or unique elements on this specific page.
                    Format your response clearly using Markdown. Use headings for sections (e.g., ## Text Content, ## Tables). Be detailed and accurate.`,
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "image_url",
                            image_url: { url: imageDataUrl },
                        },
                    ],
                },
            ],
             temperature: 0.2, // More factual
             max_tokens: 2000, // Allow longer responses
        });

         // Check if the analysis task has been changed (e.g., user navigated away)
        if (currentAnalysisTask !== pageNum) {
            console.log(`Analysis for page ${pageNum} received, but user moved on. Discarding.`);
            return; // Discard the result if it's for an old page
        }

        const analysisText = completion.content;
        pageAnalyses[pageNum] = analysisText;
        updateTocItem(pageNum, analysisText); // Update TOC with summary maybe
        // If the analyzed page is currently displayed, update the output
        if (currentPageNum === pageNum) {
            displayAnalysis(pageNum);
            highlightSearchTerms(); // Re-apply highlights if search is active
        }
        statusMessage.textContent = `Page ${pageNum} analysis complete.`;

    } catch (error) {
         if (currentAnalysisTask !== pageNum) {
            console.log(`Error during analysis for page ${pageNum}, but user moved on. Ignoring error.`);
            return; // Ignore error if it's for an old page
        }
        console.error(`Error analyzing page ${pageNum}:`, error);
        pageAnalyses[pageNum] = `Error analyzing page ${pageNum}: ${error.message || error}`;
        updateTocItem(pageNum, pageAnalyses[pageNum]); // Show error in TOC too
        if (currentPageNum === pageNum) {
             displayAnalysis(pageNum); // Show error in main view
        }
        statusMessage.textContent = `Error analyzing page ${pageNum}.`;
        // Decide if we should stop the whole process on an LLM error
        // For now, continue processing other pages.
    } finally {
        // If the task completed (success or error) and it was the one we were tracking, clear it
        if (currentAnalysisTask === pageNum) {
            currentAnalysisTask = null;
        }
    }
}

// --- Background Processing Queue ---
async function processQueue() {
    if (isProcessing || processingQueue.length === 0) {
        if (processingQueue.length === 0 && !isProcessing) {
             console.log("Processing queue finished.");
             statusMessage.textContent = "All pages processed.";
             updateProgressBar(100); // Ensure progress bar is full
        }
        return;
    }

    isProcessing = true;
    const pageNum = processingQueue.shift(); // Get the next page number

    try {
         updateStatus(totalPages - processingQueue.length, totalPages, `Processing page ${pageNum}...`);
         updateProgressBar(((totalPages - processingQueue.length -1 ) / totalPages) * 100);

        // 1. Render page to image (if not already cached)
         let imageDataUrl = pageImageCache[pageNum];
         if (!imageDataUrl) {
            statusMessage.textContent = `Rendering page ${pageNum} for analysis...`;
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1.5 }); // Consistent scale
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: context, viewport: viewport }).promise;
            imageDataUrl = canvas.toDataURL('image/png');
            pageImageCache[pageNum] = imageDataUrl; // Cache it
            statusMessage.textContent = `Page ${pageNum} rendered.`;
         }

        // 2. Analyze page using LLM
        await analyzePage(pageNum, imageDataUrl);

        // Update overall progress
        const progress = ((totalPages - processingQueue.length) / totalPages) * 100;
        updateProgressBar(progress);


    } catch (error) {
        console.error(`Error processing page ${pageNum} in queue:`, error);
        pageAnalyses[pageNum] = `Failed to process page ${pageNum}: ${error.message || error}`;
        updateTocItem(pageNum, pageAnalyses[pageNum]);
        // Optionally show a more prominent error, but continue the queue for now
        statusMessage.textContent = `Error processing page ${pageNum}. Continuing...`;
    } finally {
         isProcessing = false;
        // Schedule the next item using requestIdleCallback
        requestIdleCallback(processQueue, { timeout: 500 }); // Process next when idle, or after 500ms
    }
}

// --- UI Interaction ---
function handleFileSelect(file) {
    if (!file) return;

    if (!file.type || file.type !== 'application/pdf') {
        showErrorModal('Invalid file type. Please upload a PDF file.');
        pdfUpload.value = ''; // Reset file input
        return;
    }

     if (file.size > MAX_FILE_SIZE_BYTES) {
        showErrorModal(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is ${MAX_FILE_SIZE_MB} MB.`);
         pdfUpload.value = ''; // Reset file input
        return;
    }

    resetUI(); // Reset before starting new file
    displayFileInfo(file);
    showProcessing();

    const reader = new FileReader();
    reader.onload = async (event) => {
        const typedarray = new Uint8Array(event.target.result);
        try {
             updateStatus(0, 0, "Loading PDF document...");
             pdfDoc = await pdfjsLib.getDocument({ data: typedarray }).promise;
             totalPages = pdfDoc.numPages;
             pageCountSpan.textContent = totalPages; // Update file info too
             totalPagesDisplayImg.textContent = totalPages;
             updateStatus(0, totalPages, "Document loaded.");

            // Populate processing queue and TOC
            processingQueue = [];
             tocList.innerHTML = ''; // Clear previous TOC
            for (let i = 1; i <= totalPages; i++) {
                processingQueue.push(i);
                addTocItem(i);
            }
             tocCountSpan.textContent = totalPages;


            // Render the first page immediately for the user
            await renderPage(1);
            showResults();

            // Start background processing of the rest
            statusMessage.textContent = "Starting background analysis...";
             requestIdleCallback(processQueue); // Start processing queue when idle

        } catch (error) {
            console.error('Error loading PDF:', error);
            showErrorModal(`Error loading PDF: ${error.message || error}. The file might be corrupted or password-protected.`);
            resetUI();
        }
    };
     reader.onerror = (error) => {
        console.error("FileReader error:", error);
        showErrorModal("Error reading the file.");
        resetUI();
    };
    reader.readAsArrayBuffer(file);
}

function updateNavigation() {
    currentPageDisplayImg.textContent = currentPageNum;
    prevPageBtn.disabled = currentPageNum <= 1;
    nextPageBtn.disabled = currentPageNum >= totalPages;
    jumpToPageInput.max = totalPages;
    jumpToPageInput.placeholder = `1-${totalPages}`;

    // Update active item in TOC
    const currentActive = tocList.querySelector('.active');
    if (currentActive) {
        currentActive.classList.remove('active');
    }
    const newActive = tocList.querySelector(`[data-page="${currentPageNum}"]`);
    if (newActive) {
        newActive.classList.add('active');
        // Scroll TOC to show the active item
        newActive.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function displayAnalysis(pageNum) {
    if (pageAnalyses[pageNum]) {
        analysisOutput.textContent = pageAnalyses[pageNum];
         // If you want to render Markdown, you'll need a library like 'marked'
         // Example with marked (add CDN link to HTML):
         // import { marked } from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js';
         // analysisOutput.innerHTML = marked.parse(pageAnalyses[pageNum]);
    } else {
        analysisOutput.textContent = 'Analysis pending...';
        // analysisOutput.innerHTML = '<div class="text-center text-muted p-3"><div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div> Analysis pending...</div>';
    }
     highlightSearchTerms(); // Apply highlights after content update
}

function addTocItem(pageNum) {
    const li = document.createElement('li');
    li.classList.add('list-group-item', 'list-group-item-action');
    li.dataset.page = pageNum;
    li.style.cursor = 'pointer';
    li.innerHTML = `Page ${pageNum} <span class="badge bg-secondary float-end status-badge">Pending</span>`;
    li.addEventListener('click', () => {
        if (currentPageNum !== pageNum) {
            currentPageNum = pageNum;
            jumpToPageInput.value = pageNum; // Sync input field
            renderPage(pageNum); // This will also call displayAnalysis and updateNavigation
        }
    });
    tocList.appendChild(li);
}

function updateTocItem(pageNum, analysisText) {
    const item = tocList.querySelector(`[data-page="${pageNum}"]`);
    if (item) {
        const statusBadge = item.querySelector('.status-badge');
        if (analysisText.startsWith('Error') || analysisText.startsWith('Failed')) {
             statusBadge.classList.remove('bg-secondary', 'bg-success');
             statusBadge.classList.add('bg-danger');
             statusBadge.textContent = 'Error';
        } else if (analysisText === 'Analysis pending...') {
             statusBadge.classList.remove('bg-success', 'bg-danger');
             statusBadge.classList.add('bg-secondary');
            statusBadge.textContent = 'Pending';
        } else {
            statusBadge.classList.remove('bg-secondary', 'bg-danger');
            statusBadge.classList.add('bg-success');
            statusBadge.textContent = 'Done';
             // Optional: Add a snippet of the analysis
            // const snippet = analysisText.substring(0, 50).replace(/\n/g, ' ') + '...';
            // item.innerHTML = `Page ${pageNum} - ${snippet} <span class="badge bg-success float-end status-badge">Done</span>`;
        }
    }
}

// ... rest of the functions remain the same ...

function changePage(delta) {
    const newPage = currentPageNum + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        currentPageNum = newPage;
        jumpToPageInput.value = newPage; // Sync input field
        renderPage(currentPageNum);
    }
}

function jumpToPage() {
    const page = parseInt(jumpToPageInput.value, 10);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
        currentPageNum = page;
        renderPage(currentPageNum);
    } else {
        // Optionally provide feedback for invalid input
        jumpToPageInput.classList.add('is-invalid');
        setTimeout(() => jumpToPageInput.classList.remove('is-invalid'), 1500);
         jumpToPageInput.value = currentPageNum; // Reset to current page number
    }
}

// ... rest of the functions remain the same ...

function adjustZoom(factor) {
    currentZoom = Math.max(0.1, Math.min(5, currentZoom * factor)); // Limit zoom levels
    pageImage.style.transform = `scale(${currentZoom})`;
     pageImage.style.cursor = currentZoom > 1 ? 'zoom-out' : 'zoom-in';
}

function resetZoom() {
    currentZoom = 1.0;
    pageImage.style.transform = 'scale(1)';
     pageImage.style.cursor = 'zoom-in';
}

// --- Export & Download ---
function downloadFile(filename, text, mimeType) {
    const element = document.createElement('a');
    element.setAttribute('href', `data:${mimeType};charset=utf-8,` + encodeURIComponent(text));
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}

function exportPageMarkdown() {
    const analysis = pageAnalyses[currentPageNum];
    if (pdfDoc && analysis) {
        const filename = `${fileNameSpan.textContent.replace('.pdf', '')}_page_${currentPageNum}_analysis.md`;
         const content = `# Analysis for Page ${currentPageNum}\n\n${analysis}`;
        downloadFile(filename, content, 'text/markdown');
    } else {
        showErrorModal("No analysis available for the current page to export.");
    }
}

function exportAllMarkdown() {
     if (!pdfDoc || Object.keys(pageAnalyses).length === 0) {
        showErrorModal("No analyses available to export.");
        return;
     }

    let fullAnalysis = `# Full PDF Analysis: ${fileNameSpan.textContent}\n\n`;
    fullAnalysis += `Total Pages: ${totalPages}\n\n`;
     let pagesExported = 0;

    for (let i = 1; i <= totalPages; i++) {
        fullAnalysis += `## Page ${i}\n\n`;
        if (pageAnalyses[i]) {
            fullAnalysis += `${pageAnalyses[i]}\n\n`;
            pagesExported++;
        } else {
            fullAnalysis += `*Analysis pending or failed.*\n\n`;
        }
        fullAnalysis += '---\n\n'; // Separator
    }

    if (pagesExported === 0) {
         showErrorModal("No completed analyses available to export.");
         return;
    }

    const filename = `${fileNameSpan.textContent.replace('.pdf', '')}_full_analysis.md`;
    downloadFile(filename, fullAnalysis, 'text/markdown');
}

// ... rest of the functions remain the same ...

function downloadPageImage() {
    const imageDataUrl = pageImageCache[currentPageNum];
    if (pdfDoc && imageDataUrl) {
        const filename = `${fileNameSpan.textContent.replace('.pdf', '')}_page_${currentPageNum}.png`;
         const element = document.createElement('a');
         element.setAttribute('href', imageDataUrl);
         element.setAttribute('download', filename);
         element.style.display = 'none';
         document.body.appendChild(element);
         element.click();
         document.body.removeChild(element);
    } else {
        showErrorModal("Page image not available for download. Please ensure the page is rendered.");
    }
}

// --- Search Functionality ---
function clearSearchHighlights() {
    const highlights = analysisOutput.querySelectorAll('mark.highlight');
    highlights.forEach(mark => {
        const parent = mark.parentNode;
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize(); // Merge adjacent text nodes
    });
     // Clear TOC highlights
    tocList.querySelectorAll('.list-group-item').forEach(item => {
        item.classList.remove('border', 'border-warning', 'border-2');
    });
     searchResultsSummary.style.display = 'none';
     searchResultsSummary.textContent = '';

}

function highlightSearchTerms() {
     clearSearchHighlights(); // Clear previous highlights first
    const searchTerm = searchInput.value.trim();
    if (!searchTerm || searchTerm.length < 2) { // Require at least 2 chars
        return; // Don't highlight if search term is empty or too short
    }

    const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'); // Escape special chars, global, case-insensitive
    let matchesCount = 0;
     const matchingPages = new Set(); // Track pages with matches

    // Highlight in current analysis output
    const walker = document.createTreeWalker(analysisOutput, NodeFilter.SHOW_TEXT, null, false);
    let node;
    const nodesToReplace = []; // Store nodes and replacements to avoid modifying while iterating

    while (node = walker.nextNode()) {
        if (node.nodeValue.match(regex)) {
            nodesToReplace.push({node: node});
        }
    }

    nodesToReplace.forEach(({node}) => {
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        node.nodeValue.replace(regex, (match, p1, offset) => {
            if (offset > lastIndex) {
                fragment.appendChild(document.createTextNode(node.nodeValue.substring(lastIndex, offset)));
            }
            const mark = document.createElement('mark');
            mark.className = 'highlight';
            mark.textContent = match;
            fragment.appendChild(mark);
            lastIndex = offset + match.length;
            matchesCount++;
            matchingPages.add(currentPageNum); // Add current page if match found here
        });
        if (lastIndex < node.nodeValue.length) {
            fragment.appendChild(document.createTextNode(node.nodeValue.substring(lastIndex)));
        }
        node.parentNode.replaceChild(fragment, node);
    });


     // Highlight in TOC for all pages containing the term
     let totalMatchesAcrossAllPages = 0;
     for (const pageNum in pageAnalyses) {
         const analysisText = pageAnalyses[pageNum];
         if (analysisText && typeof analysisText === 'string') {
             const pageMatches = (analysisText.match(regex) || []).length;
             if (pageMatches > 0) {
                 totalMatchesAcrossAllPages += pageMatches;
                 matchingPages.add(parseInt(pageNum)); // Add page number to the set
                 const tocItem = tocList.querySelector(`[data-page="${pageNum}"]`);
                 if (tocItem) {
                     tocItem.classList.add('border', 'border-warning', 'border-2'); // Highlight TOC item
                 }
             }
         }
     }


    // Update summary message
     if (totalMatchesAcrossAllPages > 0) {
         searchResultsSummary.textContent = `Found ${totalMatchesAcrossAllPages} match(es) on ${matchingPages.size} page(s). Currently viewing page ${currentPageNum}.`;
         searchResultsSummary.style.display = 'block';
     } else if (searchTerm) {
         searchResultsSummary.textContent = `No matches found for "${searchTerm}".`;
          searchResultsSummary.style.display = 'block';
     }
}

// --- Event Listeners ---
function setupEventListeners() {
    uploadZone.addEventListener('click', () => pdfUpload.click()); // Make the zone clickable

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadZone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileSelect(files[0]);
        }
    });

    pdfUpload.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    prevPageBtn.addEventListener('click', () => changePage(-1));
    nextPageBtn.addEventListener('click', () => changePage(1));
    jumpToPageBtn.addEventListener('click', jumpToPage);
    jumpToPageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            jumpToPage();
        }
    });

    zoomInBtn.addEventListener('click', () => adjustZoom(1.2));
    zoomOutBtn.addEventListener('click', () => adjustZoom(1 / 1.2));
    resetZoomBtn.addEventListener('click', resetZoom);
    // Add zoom on image click (toggle zoom out if zoomed)
    pageImage.addEventListener('click', () => {
        if (currentZoom > 1) {
            resetZoom();
        } else {
            adjustZoom(1.5); // Or a different factor for click-zoom
        }
    });

    exportPageMdBtn.addEventListener('click', exportPageMarkdown);
    exportAllMdBtn.addEventListener('click', exportAllMarkdown);
    downloadPageImageBtn.addEventListener('click', downloadPageImage);

    searchButton.addEventListener('click', highlightSearchTerms);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            highlightSearchTerms();
        }
    });
    clearSearchButton.addEventListener('click', () => {
         searchInput.value = ''; // Clear the input field
         clearSearchHighlights();
    });
}

// --- Initial Setup ---
// Wrap initialization that depends on the DOM in a DOMContentLoaded listener
document.addEventListener('DOMContentLoaded', () => {
    // Initialize the Bootstrap modal instance only after DOM is ready
    if (errorModalElement) {
      errorModal = new bootstrap.Modal(errorModalElement);
    } else {
      console.error("Error Modal element not found!");
    }

    setupEventListeners(); // Setup event listeners after DOM is ready
    resetUI(); // Start with a clean slate
});
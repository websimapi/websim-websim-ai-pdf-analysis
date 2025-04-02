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

// --- DOM Element Variables (declare globally, assign in DOMContentLoaded) ---
let uploadContainer, uploadZone, pdfUpload, fileInfo, fileNameSpan, fileSizeSpan, pageCountSpan,
    processingProgress, progressBar, currentPageSpan, totalPagesSpan, statusMessage,
    resultsContainer, tocList, tocCountSpan, pdfViewer, pageImage, prevPageBtn, nextPageBtn,
    currentPageDisplayImg, totalPagesDisplayImg, jumpToPageInput, jumpToPageBtn,
    zoomInBtn, zoomOutBtn, resetZoomBtn, analysisOutput, exportPageMdBtn, exportAllMdBtn,
    downloadPageImageBtn, searchInput, searchButton, clearSearchButton, searchResultsSummary,
    errorModalElement, errorModalBody;
let errorModal; // Bootstrap modal instance

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
        console.error("Error Modal instance not available!");
    }
    // Optionally reset UI state
    resetUI();
}

// --- UI Updates ---
function updateProgressBar(value) {
    if (!progressBar) return; // Add checks in case elements aren't ready
    const percent = Math.min(100, Math.max(0, value));
    progressBar.style.width = `${percent}%`;
    progressBar.textContent = `${Math.round(percent)}%`;
    progressBar.setAttribute('aria-valuenow', percent);
}

function updateStatus(page, total, message = "") {
    if (!currentPageSpan || !totalPagesSpan || !statusMessage) return;
    currentPageSpan.textContent = page;
    totalPagesSpan.textContent = total;
    statusMessage.textContent = message;
}

function displayFileInfo(file) {
    if (!fileNameSpan || !fileSizeSpan || !fileInfo) return;
    fileNameSpan.textContent = file.name;
    fileSizeSpan.textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB`;
    fileInfo.style.display = 'block';
}

function showProcessing() {
    if (!uploadContainer || !processingProgress || !resultsContainer) return;
    uploadContainer.style.display = 'none';
    processingProgress.style.display = 'block';
    resultsContainer.style.display = 'none';
    updateProgressBar(0);
    updateStatus(0, 0, "Initializing...");
}

function showResults() {
     if (!uploadContainer || !processingProgress || !resultsContainer) return;
    uploadContainer.style.display = 'none';
    processingProgress.style.display = 'none';
    resultsContainer.style.display = 'block';
    updateNavigation();
}

function resetUI() {
    if (!uploadContainer || !processingProgress || !resultsContainer || !fileInfo || !pdfUpload || !tocList || !tocCountSpan || !analysisOutput || !pageImage || !searchInput || !searchResultsSummary) {
        console.warn("ResetUI called before all elements were ready.");
        return;
    }
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
    pageImage.alt = 'PDF Page';
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
    updateStatus(0, 0, ""); // Clear status
    updateProgressBar(0); // Reset progress bar

}

// --- PDF Rendering ---
async function renderPage(pageNum) {
    if (!pdfDoc || pageNum < 1 || pageNum > totalPages || !pageImage || !statusMessage) return;

     // Cancel previous render task if it exists
    if (currentRenderTask) {
        console.log("Cancelling previous render task");
        currentRenderTask.cancel();
        currentRenderTask = null; // Ensure it's cleared
    }


    pageImage.style.opacity = '0.5'; // Indicate loading
    pageImage.src = ''; // Clear previous image immediately
    pageImage.alt = `Loading page ${pageNum}...`; // Update alt text

    try {
        // Check cache first
        if (pageImageCache[pageNum]) {
            pageImage.src = pageImageCache[pageNum];
            pageImage.alt = `PDF Page ${pageNum}`;
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
        console.log(`Render task completed for page ${pageNum}`);
        currentRenderTask = null; // Clear task after completion


        const imageDataUrl = canvas.toDataURL('image/png'); // Use PNG for better quality
        pageImageCache[pageNum] = imageDataUrl; // Cache the rendered image
        pageImage.src = imageDataUrl;
        pageImage.alt = `PDF Page ${pageNum}`;
        pageImage.style.opacity = '1';
        updateNavigation();
        displayAnalysis(pageNum);
        highlightSearchTerms(); // Re-apply highlights if searching
        statusMessage.textContent = `Page ${pageNum} rendered.`;


    } catch (error) {
         console.log("Error caught during renderPage", error);
         // Check if it's a cancellation error before clearing the task
         if (error && (error.name === 'RenderingCancelledException' || (error.message && error.message.includes("cancelled")))) {
             console.log(`Rendering explicitly cancelled for page ${pageNum}`);
             statusMessage.textContent = `Rendering stopped.`;
             // Don't show error modal for cancellations
         } else {
             // Log the error regardless
             console.error(`Error rendering page ${pageNum}:`, error);
             // Clear task only on non-cancellation errors
              if (currentRenderTask) {
                   currentRenderTask = null;
              }
             showErrorModal(`Failed to render page ${pageNum}. The page might be corrupted or too complex. (${error.message || error})`);
             pageImage.alt = `Error rendering page ${pageNum}`;
             pageImage.src = ''; // Clear image on error
         }
    } finally {
         pageImage.style.opacity = '1'; // Ensure opacity is reset
         // Ensure task is cleared if it hasn't been already (e.g., unexpected error path)
         if (currentRenderTask) {
            console.warn("Render task might not have been cleared properly, clearing now.");
            currentRenderTask = null;
         }
    }
}

// --- LLM Analysis ---
async function analyzePage(pageNum, imageDataUrl) {
     if (!imageDataUrl) {
        console.warn(`Skipping analysis for page ${pageNum}: no image data.`);
        pageAnalyses[pageNum] = 'Skipped: No image data available for analysis.';
        updateTocItem(pageNum, pageAnalyses[pageNum]);
        return; // Don't proceed without image data
    }

    // Store the current page number being analyzed
    currentAnalysisTask = pageNum;

    try {
        if (statusMessage) statusMessage.textContent = `Analyzing page ${pageNum} with AI...`;
        console.log(`Starting analysis for page ${pageNum}`);
        const completion = await websim.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are an expert document analyzer. Analyze the provided image of a PDF page.
                    Describe ALL visible content including:
                    - Text content (extract key sentences or paragraphs, maintain original line breaks where meaningful).
                    - Tables (describe structure and summarize data).
                    - Charts/Graphs (identify type and describe data shown).
                    - Images (briefly describe).
                    - Headers/Footers/Page Numbers.
                    - Overall layout and formatting elements (e.g., columns, bold text, lists).
                    Identify the main subject matter or purpose of this specific page, key information presented, and any notable visual elements.
                    Format your response clearly using Markdown. Use headings (e.g., ## Text Content, ## Tables). Be detailed and accurate. If the page appears blank or contains minimal content, state that clearly.`,
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
         console.log(`Analysis received for page ${pageNum}`);
         // Check if the analysis task has been changed (e.g., user navigated away or reset)
        if (currentAnalysisTask !== pageNum) {
            console.log(`Analysis for page ${pageNum} received, but analysis task changed (${currentAnalysisTask}). Discarding.`);
            return; // Discard the result if it's for an old page or after reset
        }

        const analysisText = completion.content || "[AI response was empty]";
        pageAnalyses[pageNum] = analysisText;
        updateTocItem(pageNum, analysisText); // Update TOC
        // If the analyzed page is currently displayed, update the output
        if (currentPageNum === pageNum && analysisOutput) {
            displayAnalysis(pageNum);
            highlightSearchTerms(); // Re-apply highlights if search is active
        }
        if (statusMessage) statusMessage.textContent = `Page ${pageNum} analysis complete.`;

    } catch (error) {
         console.error(`Error analyzing page ${pageNum}:`, error);
         // Check if the analysis task has been changed before processing the error
         if (currentAnalysisTask !== pageNum) {
            console.log(`Error during analysis for page ${pageNum}, but analysis task changed (${currentAnalysisTask}). Ignoring error.`);
            return; // Ignore error if it's for an old page or after reset
        }
        pageAnalyses[pageNum] = `Error analyzing page ${pageNum}: ${error.message || error}`;
        updateTocItem(pageNum, pageAnalyses[pageNum]); // Show error in TOC too
        if (currentPageNum === pageNum && analysisOutput) {
             displayAnalysis(pageNum); // Show error in main view
        }
        if (statusMessage) statusMessage.textContent = `Error analyzing page ${pageNum}.`;
        // Decide if we should stop the whole process on an LLM error
        // For now, continue processing other pages.
    } finally {
        // If the task completed (success or error) and it was the one we were tracking, clear it
        if (currentAnalysisTask === pageNum) {
            console.log(`Clearing analysis task for page ${pageNum}`);
            currentAnalysisTask = null;
        }
    }
}

// --- Background Processing Queue ---
async function processQueue() {
    if (isProcessing || processingQueue.length === 0) {
        if (processingQueue.length === 0 && !isProcessing && pdfDoc) { // Check pdfDoc to ensure we actually processed something
             console.log("Processing queue finished.");
             if(statusMessage) statusMessage.textContent = "All pages processed.";
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
            if(statusMessage) statusMessage.textContent = `Rendering page ${pageNum} for analysis...`;
            const page = await pdfDoc.getPage(pageNum);
            // Use a slightly lower scale for background rendering for performance? Or keep consistent? Let's keep consistent.
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            // Add background color to canvas for pages with transparency
            context.fillStyle = 'white';
            context.fillRect(0, 0, canvas.width, canvas.height);

            await page.render({ canvasContext: context, viewport: viewport, renderInteractiveForms: true }).promise;
            imageDataUrl = canvas.toDataURL('image/png');
            pageImageCache[pageNum] = imageDataUrl; // Cache it
            if(statusMessage) statusMessage.textContent = `Page ${pageNum} rendered for analysis.`;
         }

        // 2. Analyze page using LLM
        await analyzePage(pageNum, imageDataUrl);

        // Update overall progress after analysis step completes
        const progress = ((totalPages - processingQueue.length) / totalPages) * 100;
        updateProgressBar(progress);


    } catch (error) {
        console.error(`Error processing page ${pageNum} in queue:`, error);
        pageAnalyses[pageNum] = `Failed to process page ${pageNum}: ${error.message || error}`;
        updateTocItem(pageNum, pageAnalyses[pageNum]);
        // Optionally show a more prominent error, but continue the queue for now
        if(statusMessage) statusMessage.textContent = `Error processing page ${pageNum}. Continuing...`;
    } finally {
         isProcessing = false;
        // Schedule the next item using requestIdleCallback if there are more items
        if (processingQueue.length > 0) {
             requestIdleCallback(processQueue, { timeout: 500 }); // Process next when idle, or after 500ms
        } else {
             console.log("Processing queue finished (final item processed).");
             if(statusMessage) statusMessage.textContent = "All pages processed.";
             updateProgressBar(100);
        }
    }
}

// --- UI Interaction ---
function handleFileSelect(file) {
    if (!file) return;

    if (!file.type || file.type !== 'application/pdf') {
        showErrorModal('Invalid file type. Please upload a PDF file.');
        if (pdfUpload) pdfUpload.value = ''; // Reset file input
        return;
    }

     if (file.size > MAX_FILE_SIZE_BYTES) {
        showErrorModal(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is ${MAX_FILE_SIZE_MB} MB.`);
         if (pdfUpload) pdfUpload.value = ''; // Reset file input
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
             if(pageCountSpan) pageCountSpan.textContent = totalPages; // Update file info too
             if(totalPagesDisplayImg) totalPagesDisplayImg.textContent = totalPages;
             updateStatus(0, totalPages, "Document loaded.");

            // Populate processing queue and TOC
            processingQueue = [];
             if(tocList) tocList.innerHTML = ''; // Clear previous TOC
            for (let i = 1; i <= totalPages; i++) {
                processingQueue.push(i);
                addTocItem(i);
            }
             if(tocCountSpan) tocCountSpan.textContent = totalPages;


            // Render the first page immediately for the user
            await renderPage(1);
            showResults();

            // Start background processing of the rest
            if(statusMessage) statusMessage.textContent = "Starting background analysis...";
             requestIdleCallback(processQueue); // Start processing queue when idle

        } catch (error) {
            console.error('Error loading PDF:', error);
             let errorMsg = `Error loading PDF: ${error.message || error}.`;
            if (error.name === 'PasswordException') {
                errorMsg = 'Error loading PDF: Document is password-protected and cannot be analyzed.';
            } else if (error.name === 'InvalidPDFException') {
                 errorMsg = 'Error loading PDF: Invalid or corrupted PDF file.';
            }
            showErrorModal(errorMsg);
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
    if (!currentPageDisplayImg || !prevPageBtn || !nextPageBtn || !jumpToPageInput || !tocList) return;

    currentPageDisplayImg.textContent = currentPageNum;
    prevPageBtn.disabled = currentPageNum <= 1;
    nextPageBtn.disabled = currentPageNum >= totalPages;
    jumpToPageInput.max = totalPages;
    // Only set placeholder if value is empty
    if (!jumpToPageInput.value) {
         jumpToPageInput.placeholder = totalPages > 0 ? `1-${totalPages}` : '#';
    }


    // Update active item in TOC
    const currentActive = tocList.querySelector('.active');
    if (currentActive) {
        currentActive.classList.remove('active');
    }
    const newActive = tocList.querySelector(`[data-page="${currentPageNum}"]`);
    if (newActive) {
        newActive.classList.add('active');
        // Scroll TOC to show the active item if it's not fully visible
        requestAnimationFrame(() => { // Use rAF to ensure styles are applied
             const tocRect = tocList.getBoundingClientRect();
             const itemRect = newActive.getBoundingClientRect();
             if (itemRect.top < tocRect.top || itemRect.bottom > tocRect.bottom) {
                 newActive.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
             }
         });
    }
}

function displayAnalysis(pageNum) {
     if (!analysisOutput) return;
    if (pageAnalyses[pageNum]) {
        analysisOutput.textContent = pageAnalyses[pageNum];
         // Basic check if content looks like an error message
         if (pageAnalyses[pageNum].startsWith('Error') || pageAnalyses[pageNum].startsWith('Failed') || pageAnalyses[pageNum].startsWith('Skipped')) {
             analysisOutput.classList.add('text-danger');
         } else {
             analysisOutput.classList.remove('text-danger');
         }
         // Consider using a Markdown library here for rich formatting
         // import { marked } from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js';
         // try {
         //   analysisOutput.innerHTML = marked.parse(pageAnalyses[pageNum]);
         // } catch (e) {
         //   console.error("Markdown parsing error:", e);
         //   analysisOutput.textContent = pageAnalyses[pageNum]; // Fallback to text
         // }
    } else {
        analysisOutput.textContent = 'Analysis pending...';
        analysisOutput.classList.remove('text-danger');
        // analysisOutput.innerHTML = '<div class="text-center text-muted p-3"><div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div> Analysis pending...</div>';
    }
     highlightSearchTerms(); // Apply highlights after content update
}

function addTocItem(pageNum) {
    if (!tocList) return;
    const li = document.createElement('li');
    li.classList.add('list-group-item', 'list-group-item-action');
    li.dataset.page = pageNum;
    li.style.cursor = 'pointer';
    li.innerHTML = `<span class="page-number">Page ${pageNum}</span> <span class="badge bg-secondary float-end status-badge">Pending</span>`;
    li.addEventListener('click', () => {
        if (currentPageNum !== pageNum) {
            currentPageNum = pageNum;
            if(jumpToPageInput) jumpToPageInput.value = pageNum; // Sync input field
            renderPage(pageNum); // This will also call displayAnalysis and updateNavigation
        }
    });
    tocList.appendChild(li);
}

function updateTocItem(pageNum, analysisText) {
     if (!tocList) return;
    const item = tocList.querySelector(`[data-page="${pageNum}"]`);
    if (item) {
        const statusBadge = item.querySelector('.status-badge');
         if (!statusBadge) return; // Safety check

        if (analysisText.startsWith('Error') || analysisText.startsWith('Failed') || analysisText.startsWith('Skipped')) {
             statusBadge.className = 'badge bg-danger float-end status-badge'; // Replace classes
             statusBadge.textContent = 'Error';
        } else if (analysisText === 'Analysis pending...') {
             statusBadge.className = 'badge bg-secondary float-end status-badge';
            statusBadge.textContent = 'Pending';
        } else {
            statusBadge.className = 'badge bg-success float-end status-badge';
            statusBadge.textContent = 'Done';
             // Optional: Add a tooltip with a snippet? Too complex for now.
        }
    }
}


function changePage(delta) {
    const newPage = currentPageNum + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        currentPageNum = newPage;
         if(jumpToPageInput) jumpToPageInput.value = newPage; // Sync input field
        renderPage(currentPageNum);
    }
}

function jumpToPage() {
     if (!jumpToPageInput) return;
    const page = parseInt(jumpToPageInput.value, 10);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
        currentPageNum = page;
        renderPage(currentPageNum);
        jumpToPageInput.classList.remove('is-invalid'); // Remove error state if successful
    } else {
        // Provide feedback for invalid input
        jumpToPageInput.classList.add('is-invalid');
        // Don't reset value immediately, let user see the error
        // jumpToPageInput.value = currentPageNum; // Reset to current page number
        setTimeout(() => jumpToPageInput.classList.remove('is-invalid'), 2000);
    }
}


function adjustZoom(factor) {
     if (!pageImage) return;
    currentZoom = Math.max(0.1, Math.min(5, currentZoom * factor)); // Limit zoom levels
    pageImage.style.transform = `scale(${currentZoom})`;
     pageImage.style.cursor = currentZoom > 1 ? 'zoom-out' : 'zoom-in';
}

function resetZoom() {
    if (!pageImage) return;
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
    const currentFileName = fileNameSpan?.textContent || 'document'; // Use span content or default

    if (pdfDoc && analysis && !analysis.startsWith('Error') && !analysis.startsWith('Failed') && !analysis.startsWith('Skipped') && analysis !== 'Analysis pending...') {
        const filename = `${currentFileName.replace('.pdf', '')}_page_${currentPageNum}_analysis.md`;
         const content = `# Analysis for Page ${currentPageNum} of ${currentFileName}\n\n${analysis}`;
        downloadFile(filename, content, 'text/markdown');
    } else {
        showErrorModal("No valid analysis available for the current page to export.");
    }
}

function exportAllMarkdown() {
     const currentFileName = fileNameSpan?.textContent || 'document';
     if (!pdfDoc || totalPages === 0) {
        showErrorModal("No PDF loaded to export analysis from.");
        return;
     }

    let fullAnalysis = `# Full PDF Analysis: ${currentFileName}\n\n`;
    fullAnalysis += `Total Pages: ${totalPages}\n\n---\n\n`;
     let pagesExported = 0;
     let pagesPending = 0;
     let pagesError = 0;

    for (let i = 1; i <= totalPages; i++) {
        fullAnalysis += `## Page ${i}\n\n`;
        if (pageAnalyses[i]) {
            if (pageAnalyses[i].startsWith('Error') || pageAnalyses[i].startsWith('Failed') || pageAnalyses[i].startsWith('Skipped')) {
                fullAnalysis += `*Analysis Error/Skipped: ${pageAnalyses[i]}*\n\n`;
                pagesError++;
            } else if (pageAnalyses[i] === 'Analysis pending...') {
                 fullAnalysis += `*Analysis pending.*\n\n`;
                 pagesPending++;
            }
            else {
                fullAnalysis += `${pageAnalyses[i]}\n\n`;
                pagesExported++;
            }
        } else {
            // Should ideally not happen if TOC is populated correctly, but handle anyway
            fullAnalysis += `*Analysis not available.*\n\n`;
            pagesPending++; // Count as pending if missing entirely
        }
        fullAnalysis += '---\n\n'; // Separator
    }

    if (pagesExported === 0 && pagesPending === 0 && pagesError > 0) {
         showErrorModal("All page analyses resulted in errors. Nothing to export.");
         return;
    }
     if (pagesExported === 0 && pagesPending > 0) {
        showErrorModal("No analyses have completed successfully yet. Please wait for processing to finish.");
        return;
    }
     if (pagesExported === 0) {
         showErrorModal("No valid analysis data found to export.");
         return;
     }


    const filename = `${currentFileName.replace('.pdf', '')}_full_analysis.md`;
    downloadFile(filename, fullAnalysis, 'text/markdown');
     if (pagesPending > 0 || pagesError > 0) {
         // Optionally show a non-modal notification about incomplete/error pages in export
         console.warn(`Exported ${pagesExported} pages. ${pagesPending} pending, ${pagesError} errors.`);
     }
}


function downloadPageImage() {
    const imageDataUrl = pageImageCache[currentPageNum];
    const currentFileName = fileNameSpan?.textContent || 'document';
    if (pdfDoc && imageDataUrl) {
        const filename = `${currentFileName.replace('.pdf', '')}_page_${currentPageNum}.png`;
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
    if (!analysisOutput || !tocList || !searchResultsSummary) return;

    const highlights = analysisOutput.querySelectorAll('mark.highlight');
    highlights.forEach(mark => {
        const parent = mark.parentNode;
        if (parent) { // Ensure parent exists before manipulating
            parent.replaceChild(document.createTextNode(mark.textContent), mark);
            parent.normalize(); // Merge adjacent text nodes
        }
    });
     // Clear TOC highlights
    tocList.querySelectorAll('.list-group-item').forEach(item => {
        item.classList.remove('border', 'border-warning', 'border-2');
        // Reset background if needed, assuming default is handled by CSS
    });
     searchResultsSummary.style.display = 'none';
     searchResultsSummary.textContent = '';

}

function highlightSearchTerms() {
    if (!searchInput || !analysisOutput || !tocList || !searchResultsSummary) return;
     clearSearchHighlights(); // Clear previous highlights first
    const searchTerm = searchInput.value.trim();
    if (!searchTerm || searchTerm.length < 2) { // Require at least 2 chars
        return; // Don't highlight if search term is empty or too short
    }

     const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); // Escape special chars, global, case-insensitive

     let matchesInCurrentPage = 0;
     const matchingPages = new Set(); // Track pages with matches
     let totalMatchesAcrossAllPages = 0;

     // 1. Highlight in currently displayed analysis output
     try {
         const walker = document.createTreeWalker(analysisOutput, NodeFilter.SHOW_TEXT, null, false);
         let node;
         const nodesToModify = []; // Collect nodes and modifications

         while (node = walker.nextNode()) {
             const nodeValue = node.nodeValue;
             let matchFound = false;
             const fragment = document.createDocumentFragment();
             let lastIndex = 0;

             nodeValue.replace(regex, (match, offset) => {
                 matchFound = true;
                 if (offset > lastIndex) {
                     fragment.appendChild(document.createTextNode(nodeValue.substring(lastIndex, offset)));
                 }
                 const mark = document.createElement('mark');
                 mark.className = 'highlight';
                 mark.textContent = match;
                 fragment.appendChild(mark);
                 lastIndex = offset + match.length;
                 matchesInCurrentPage++;
             });

             if (matchFound) {
                 if (lastIndex < nodeValue.length) {
                     fragment.appendChild(document.createTextNode(nodeValue.substring(lastIndex)));
                 }
                 nodesToModify.push({ node: node, fragment: fragment });
             }
         }

         // Apply modifications after iteration
         nodesToModify.forEach(({ node, fragment }) => {
              if(node.parentNode) { // Check if node is still in DOM
                 node.parentNode.replaceChild(fragment, node);
              }
         });

     } catch (e) {
         console.error("Error during text node processing for highlighting:", e);
     }


     // 2. Search through all stored analyses and highlight TOC items
     for (const pageNumStr in pageAnalyses) {
         const pageNum = parseInt(pageNumStr);
         const analysisText = pageAnalyses[pageNum];
         if (analysisText && typeof analysisText === 'string') {
             const pageMatches = (analysisText.match(regex) || []).length;
             if (pageMatches > 0) {
                 totalMatchesAcrossAllPages += pageMatches;
                 matchingPages.add(pageNum); // Add page number to the set
                 const tocItem = tocList.querySelector(`[data-page="${pageNum}"]`);
                 if (tocItem) {
                     tocItem.classList.add('border', 'border-warning', 'border-2'); // Highlight TOC item
                 }
             }
         }
     }


    // 3. Update summary message
     if (totalMatchesAcrossAllPages > 0) {
         searchResultsSummary.textContent = `Found ${totalMatchesAcrossAllPages} match(es) on ${matchingPages.size} page(s). ${matchesInCurrentPage} on this page (${currentPageNum}).`;
         searchResultsSummary.style.display = 'block';
     } else if (searchTerm) { // Only show "not found" if a search term was entered
         searchResultsSummary.textContent = `No matches found for "${searchTerm}".`;
          searchResultsSummary.style.display = 'block';
     }
}

// --- Event Listeners Setup ---
function setupEventListeners() {
    // Ensure elements exist before adding listeners
    if (!uploadZone || !pdfUpload || !prevPageBtn || !nextPageBtn || !jumpToPageBtn || !jumpToPageInput || !zoomInBtn || !zoomOutBtn || !resetZoomBtn || !pageImage || !exportPageMdBtn || !exportAllMdBtn || !downloadPageImageBtn || !searchButton || !searchInput || !clearSearchButton) {
        console.error("Cannot setup event listeners: One or more required elements not found in the DOM.");
        // Optionally show an error to the user, though this indicates a fundamental problem
         // showErrorModal("Initialization Error: UI components missing. Please refresh the page.");
        return;
    }

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
            e.preventDefault(); // Prevent potential form submission
            jumpToPage();
        }
    });
    // Clear validation on input change
    jumpToPageInput.addEventListener('input', () => {
        jumpToPageInput.classList.remove('is-invalid');
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
             e.preventDefault(); // Prevent potential form submission
            highlightSearchTerms();
        }
    });
    // Optional: Clear highlights when search input is cleared manually
    searchInput.addEventListener('input', () => {
        if (searchInput.value.trim() === '') {
            clearSearchHighlights();
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
    // Assign elements from the DOM
    uploadContainer = document.getElementById('upload-container');
    uploadZone = document.getElementById('upload-zone');
    pdfUpload = document.getElementById('pdf-upload');
    fileInfo = document.getElementById('file-info');
    fileNameSpan = document.getElementById('file-name');
    fileSizeSpan = document.getElementById('file-size');
    pageCountSpan = document.getElementById('page-count');
    processingProgress = document.getElementById('processing-progress');
    progressBar = document.getElementById('progress-bar');
    currentPageSpan = document.getElementById('current-page');
    totalPagesSpan = document.getElementById('total-pages');
    statusMessage = document.getElementById('status-message');
    resultsContainer = document.getElementById('results-container');
    tocList = document.getElementById('toc-list');
    tocCountSpan = document.getElementById('toc-count');
    pdfViewer = document.getElementById('pdf-viewer');
    pageImage = document.getElementById('page-image');
    prevPageBtn = document.getElementById('prev-page');
    nextPageBtn = document.getElementById('next-page');
    currentPageDisplayImg = document.getElementById('current-page-display-img');
    totalPagesDisplayImg = document.getElementById('total-pages-display-img');
    jumpToPageInput = document.getElementById('jump-to-page-input');
    jumpToPageBtn = document.getElementById('jump-to-page-btn');
    zoomInBtn = document.getElementById('zoom-in');
    zoomOutBtn = document.getElementById('zoom-out');
    resetZoomBtn = document.getElementById('reset-zoom');
    analysisOutput = document.getElementById('analysis-output');
    exportPageMdBtn = document.getElementById('export-page-md');
    exportAllMdBtn = document.getElementById('export-all-md');
    downloadPageImageBtn = document.getElementById('download-page-image');
    searchInput = document.getElementById('search-input');
    searchButton = document.getElementById('search-button');
    clearSearchButton = document.getElementById('clear-search-button');
    searchResultsSummary = document.getElementById('search-results-summary');
    errorModalElement = document.getElementById('errorModal');
    errorModalBody = document.getElementById('errorModalBody');

    // Initialize the Bootstrap modal instance
    if (errorModalElement) {
      try {
        errorModal = new bootstrap.Modal(errorModalElement);
      } catch (e) {
        console.error("Failed to initialize Bootstrap modal:", e);
        // Fallback or further error handling could go here
      }
    } else {
      console.error("Error Modal element not found in DOM!");
    }

    setupEventListeners(); // Setup event listeners after assigning elements
    resetUI(); // Start with a clean slate
});
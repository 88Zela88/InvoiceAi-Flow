import { db, storage, auth } from './firebase.js';
import { collection, addDoc, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-storage.js";
import { showToast, closeModal, openModal } from './ui.js';
import { currentUser, currentUserData, activeClientCompany, currentRole } from './auth.js';

export let scannedPages = [];
export let activeScanPageIdx = 0;
export let rescanningInvoiceId = null;
export let lastExtractedAiOverlay = null;
export let scanOverlayVisible = true;

const DEFAULT_AI_COORDS = {
    vendor: { x: 24, y: 15 },
    ico: { x: 26, y: 26 },
    invoiceNumber: { x: 74, y: 14 },
    dateIssue: { x: 72, y: 34 },
    amount: { x: 74, y: 78 },
    account: { x: 28, y: 80 }
};

function clampCoord(val, fallback) {
    const n = Number(val);
    if (isNaN(n) || n < 4 || n > 94) return fallback;
    return Math.round(n);
}

export function normalizeAiOverlayCoords(rawBoxes) {
    const boxes = rawBoxes && typeof rawBoxes === 'object' ? rawBoxes : {};
    return {
        vendor: {
            x: clampCoord(boxes.vendor?.x, DEFAULT_AI_COORDS.vendor.x),
            y: clampCoord(boxes.vendor?.y, DEFAULT_AI_COORDS.vendor.y)
        },
        ico: {
            x: clampCoord(boxes.ico?.x, DEFAULT_AI_COORDS.ico.x),
            y: clampCoord(boxes.ico?.y, DEFAULT_AI_COORDS.ico.y)
        },
        invoiceNumber: {
            x: clampCoord(boxes.invoiceNumber?.x, DEFAULT_AI_COORDS.invoiceNumber.x),
            y: clampCoord(boxes.invoiceNumber?.y, DEFAULT_AI_COORDS.invoiceNumber.y)
        },
        dateIssue: {
            x: clampCoord(boxes.dateIssue?.x, DEFAULT_AI_COORDS.dateIssue.x),
            y: clampCoord(boxes.dateIssue?.y, DEFAULT_AI_COORDS.dateIssue.y)
        },
        amount: {
            x: clampCoord(boxes.amount?.x, DEFAULT_AI_COORDS.amount.x),
            y: clampCoord(boxes.amount?.y, DEFAULT_AI_COORDS.amount.y)
        },
        account: {
            x: clampCoord(boxes.account?.x, DEFAULT_AI_COORDS.account.x),
            y: clampCoord(boxes.account?.y, DEFAULT_AI_COORDS.account.y)
        }
    };
}

export function focusAiField(inputId, pinKey) {
    const el = document.getElementById(inputId);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
        el.classList.add('ring-2', 'ring-emerald-500');
        setTimeout(() => el.classList.remove('ring-2', 'ring-emerald-500'), 1600);
    }
    if (pinKey) {
        document.querySelectorAll(`[data-ai-pin="${pinKey}"]`).forEach(pin => {
            pin.classList.add('scale-110', 'ring-2', 'ring-white');
            setTimeout(() => pin.classList.remove('scale-110', 'ring-2', 'ring-white'), 1600);
        });
    }
}

export function renderAiOverlayElements(overlayContainerId, barContainerId, dataObj, coordsObj, mode = 'scan') {
    const overlayEl = document.getElementById(overlayContainerId);
    const barEl = document.getElementById(barContainerId);
    const coords = normalizeAiOverlayCoords(coordsObj);

    const fieldMap = mode === 'scan'
        ? {
            vendor: 'field-vendor',
            ico: 'field-ico',
            invoiceNumber: 'field-invoice-num',
            dateIssue: 'field-date-issue',
            amount: 'field-amount',
            account: 'field-account'
        }
        : {
            vendor: 'detail-vendor',
            ico: 'detail-ico',
            invoiceNumber: 'detail-invoice-num',
            dateIssue: 'detail-due-issue',
            amount: 'detail-amount',
            account: 'detail-account'
        };

    const items = [
        {
            key: 'vendor',
            label: 'Dodavatel',
            shortDesc: 'Zde AI našlo Dodavatele',
            value: dataObj.vendor || '',
            colorBg: 'bg-emerald-600/95 border-emerald-300',
            chipClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25',
            dotClass: 'bg-emerald-400',
            pos: coords.vendor,
            targetInput: fieldMap.vendor
        },
        {
            key: 'ico',
            label: 'IČO',
            shortDesc: 'Zde AI našlo IČO',
            value: dataObj.ico || '',
            colorBg: 'bg-sky-600/95 border-sky-300',
            chipClass: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30 hover:bg-sky-500/25',
            dotClass: 'bg-sky-400',
            pos: coords.ico,
            targetInput: fieldMap.ico
        },
        {
            key: 'invoiceNumber',
            label: 'Doklad / VS',
            shortDesc: 'Zde AI našlo Číslo dokladu',
            value: dataObj.invoiceNumber || dataObj.vs || '',
            colorBg: 'bg-indigo-600/95 border-indigo-300',
            chipClass: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/25',
            dotClass: 'bg-indigo-400',
            pos: coords.invoiceNumber,
            targetInput: fieldMap.invoiceNumber
        },
        {
            key: 'dateIssue',
            label: 'Datum / DUZP',
            shortDesc: 'Zde AI našlo Datum',
            value: dataObj.dateIssue || dataObj.dateTax || '',
            colorBg: 'bg-amber-600/95 border-amber-300',
            chipClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/25',
            dotClass: 'bg-amber-400',
            pos: coords.dateIssue,
            targetInput: fieldMap.dateIssue
        },
        {
            key: 'amount',
            label: 'Celkem',
            shortDesc: 'Zde AI našlo Celkovou částku',
            value: dataObj.amount ? `${Number(dataObj.amount).toLocaleString('cs-CZ')} Kč` : '',
            colorBg: 'bg-rose-600/95 border-rose-300',
            chipClass: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30 hover:bg-rose-500/25',
            dotClass: 'bg-rose-400',
            pos: coords.amount,
            targetInput: fieldMap.amount
        },
        {
            key: 'account',
            label: 'Účet',
            shortDesc: 'Zde AI našlo Bankovní účet',
            value: dataObj.accountNumber || dataObj.account || '',
            colorBg: 'bg-violet-600/95 border-violet-300',
            chipClass: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30 hover:bg-violet-500/25',
            dotClass: 'bg-violet-400',
            pos: coords.account,
            targetInput: fieldMap.account
        }
    ].filter(item => String(item.value).trim() !== '');

    if (overlayEl) {
        overlayEl.innerHTML = '';
        items.forEach(item => {
            const safeVal = String(item.value).replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const pin = document.createElement('button');
            pin.type = 'button';
            pin.setAttribute('data-ai-pin', item.key);
            pin.title = `${item.shortDesc}: ${item.value} (kliknutím upravíte pole)`;
            pin.style.left = `${item.pos.x}%`;
            pin.style.top = `${item.pos.y}%`;
            pin.className = `pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full border text-[10px] font-bold text-white shadow-lg backdrop-blur-sm flex items-center gap-1 transition transform hover:scale-110 cursor-pointer ${item.colorBg}`;
            pin.onclick = (ev) => {
                ev.stopPropagation();
                focusAiField(item.targetInput, item.key);
            };
            pin.innerHTML = `
                <span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse shrink-0"></span>
                <span class="opacity-90">${item.label}:</span>
                <span class="truncate max-w-[110px]">${safeVal}</span>
            `;
            overlayEl.appendChild(pin);
        });
    }

    if (barEl) {
        if (items.length === 0) {
            barEl.classList.add('hidden');
            barEl.classList.remove('flex');
            barEl.innerHTML = '';
        } else {
            barEl.classList.remove('hidden');
            barEl.classList.add('flex');
            const chipsHtml = items.map(item => {
                const safeVal = String(item.value).replace(/</g, '&lt;').replace(/>/g, '&gt;');
                return `
                    <button type="button" onclick="focusAiField('${item.targetInput}', '${item.key}')" title="${item.shortDesc}" class="px-2 py-1 rounded-lg border text-[11px] font-semibold transition flex items-center gap-1.5 cursor-pointer ${item.chipClass}">
                        <span class="w-2 h-2 rounded-full ${item.dotClass} shrink-0"></span>
                        <span class="opacity-75">${item.shortDesc}:</span>
                        <strong class="truncate max-w-[140px]">${safeVal}</strong>
                    </button>
                `;
            }).join('');

            const toggleBtnHtml = mode === 'scan'
                ? `<button type="button" onclick="toggleScanAiOverlay()" class="ml-auto px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-bold hover:opacity-90 transition flex items-center gap-1">
                       <i data-lucide="eye" class="w-3 h-3"></i> Body na fotce
                   </button>`
                : '';

            barEl.innerHTML = `
                <div class="w-full flex items-center justify-between mb-1">
                    <span class="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <i data-lucide="sparkles" class="w-3 h-3"></i> Vizuální kontrola AI vytěžení (kliknutím na štítek zvýrazníte pole)
                    </span>
                    ${toggleBtnHtml}
                </div>
                <div class="flex flex-wrap items-center gap-1.5 w-full">${chipsHtml}</div>
            `;
            if (window.lucide) window.lucide.createIcons();
        }
    }
}

export function toggleScanAiOverlay() {
    const overlayEl = document.getElementById('scan-ai-overlay');
    if (!overlayEl) return;
    scanOverlayVisible = !scanOverlayVisible;
    if (scanOverlayVisible) {
        overlayEl.classList.remove('hidden');
    } else {
        overlayEl.classList.add('hidden');
    }
}

export function calculateScanAmounts(source = 'total') {
    const baseInput = document.getElementById('field-base-amount');
    const vatInput = document.getElementById('field-vat-amount');
    const totalInput = document.getElementById('field-amount');
    const rateSelect = document.getElementById('field-vat-rate');
    if (!baseInput || !vatInput || !totalInput || !rateSelect) return;

    const rate = parseFloat(rateSelect.value) || 0;
    if (source === 'base') {
        const base = parseFloat(baseInput.value) || 0;
        const vat = Math.round(base * (rate / 100) * 100) / 100;
        vatInput.value = vat.toFixed(2);
        totalInput.value = (base + vat).toFixed(2);
    } else if (source === 'vat') {
        const base = parseFloat(baseInput.value) || 0;
        const vat = parseFloat(vatInput.value) || 0;
        totalInput.value = (base + vat).toFixed(2);
    } else {
        const total = parseFloat(totalInput.value) || 0;
        if (total > 0) {
            const base = rate === 0 ? total : Math.round((total / (1 + (rate / 100))) * 100) / 100;
            baseInput.value = base.toFixed(2);
            vatInput.value = (total - base).toFixed(2);
        }
    }
}

function resetScanModalFields() {
    const ids = [
        'field-vendor',
        'field-ico',
        'field-invoice-num',
        'field-vs',
        'field-date-issue',
        'field-date-tax',
        'field-date-due',
        'field-base-amount',
        'field-vat-amount',
        'field-amount',
        'field-account'
    ];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const vatRate = document.getElementById('field-vat-rate');
    if (vatRate) vatRate.value = '21';
}

export function triggerScan() {
    rescanningInvoiceId = null;
    window.rescanningInvoiceId = null;
    lastExtractedAiOverlay = null;
    scannedPages = [];
    activeScanPageIdx = 0;
    window.scannedPages = scannedPages;
    window.activeScanPageIdx = activeScanPageIdx;

    resetScanModalFields();

    const titleEl = document.getElementById('scan-modal-title');
    const subEl = document.getElementById('scan-modal-subtitle');
    const badgeEl = document.getElementById('scan-rescan-badge');
    const submitLabelEl = document.getElementById('scan-submit-label');
    if (titleEl) titleEl.textContent = 'AI Skenování & Vytěžení faktury';
    if (subEl) subEl.textContent = 'Automatická detekce polí a kontrola údajů';
    if (badgeEl) badgeEl.classList.add('hidden');
    if (submitLabelEl) submitLabelEl.textContent = 'Uložit & Odeslat účetní';

    const previewImg = document.getElementById('scan-preview-img');
    if (previewImg) {
        previewImg.src = '';
        previewImg.classList.add('hidden');
    }
    document.getElementById('scan-ai-overlay')?.classList.add('hidden');
    const highlightsBar = document.getElementById('scan-ai-highlights-bar');
    if (highlightsBar) {
        highlightsBar.classList.add('hidden');
        highlightsBar.classList.remove('flex');
        highlightsBar.innerHTML = '';
    }
    document.getElementById('scan-dropzone')?.classList.remove('hidden');
    document.getElementById('scan-loading')?.classList.add('hidden');
    document.getElementById('scan-line-anim')?.classList.add('hidden');

    const pageControls = document.getElementById('scan-pages-controls');
    if (pageControls) pageControls.remove();

    if (typeof window.updateDynamicClients === 'function') window.updateDynamicClients();
    openModal('scan-modal');
}

export function startRescanForInvoice(inv) {
    if (!inv || !inv.id) {
        showToast("Doklad pro přefocení nebyl nalezen.", "warning");
        return;
    }

    rescanningInvoiceId = inv.id;
    window.rescanningInvoiceId = inv.id;
    lastExtractedAiOverlay = inv.aiOverlay || null;
    scannedPages = [];
    activeScanPageIdx = 0;
    window.scannedPages = scannedPages;
    window.activeScanPageIdx = activeScanPageIdx;

    if (typeof window.updateDynamicClients === 'function') window.updateDynamicClients();

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val !== undefined && val !== null ? val : ''; };
    setVal('field-client-name', inv.clientName || activeClientCompany || '');
    setVal('field-vendor', inv.vendor || '');
    setVal('field-ico', inv.ico || '');
    setVal('field-invoice-num', inv.invoiceNumber || '');
    setVal('field-vs', inv.vs || '');
    setVal('field-type', inv.type || 'Přijatá faktura');
    setVal('field-payment-method', inv.paymentMethod || 'Převodem');
    setVal('field-date-issue', inv.dateIssue || '');
    setVal('field-date-tax', inv.dateTax || inv.dateIssue || '');
    setVal('field-date-due', inv.dateDue || '');
    setVal('field-base-amount', inv.baseAmount || '');
    setVal('field-vat-rate', inv.vatRate || '21');
    setVal('field-vat-amount', inv.vatAmount || '');
    setVal('field-amount', inv.amount || '');
    setVal('field-account', inv.accountNumber || '');

    const titleEl = document.getElementById('scan-modal-title');
    const subEl = document.getElementById('scan-modal-subtitle');
    const badgeEl = document.getElementById('scan-rescan-badge');
    const submitLabelEl = document.getElementById('scan-submit-label');
    if (titleEl) titleEl.textContent = 'Znovu naskenovat doklad';
    if (subEl) subEl.textContent = `Přepisujete existující doklad: ${inv.vendor || inv.invoiceNumber || inv.id}`;
    if (badgeEl) badgeEl.classList.remove('hidden');
    if (submitLabelEl) submitLabelEl.textContent = 'Přepsat doklad novým skenem';

    const previewImg = document.getElementById('scan-preview-img');
    if (previewImg) {
        previewImg.src = '';
        previewImg.classList.add('hidden');
    }
    document.getElementById('scan-ai-overlay')?.classList.add('hidden');
    const highlightsBar = document.getElementById('scan-ai-highlights-bar');
    if (highlightsBar) {
        highlightsBar.classList.add('hidden');
        highlightsBar.classList.remove('flex');
        highlightsBar.innerHTML = '';
    }
    document.getElementById('scan-dropzone')?.classList.remove('hidden');
    document.getElementById('scan-loading')?.classList.add('hidden');
    document.getElementById('scan-line-anim')?.classList.add('hidden');

    const pageControls = document.getElementById('scan-pages-controls');
    if (pageControls) pageControls.remove();

    closeModal('detail-modal');
    openModal('scan-modal');
    if (window.lucide) window.lucide.createIcons();
    showToast("Vyberte nebo vyfoťte nový snímek pro přepsání dokladu.", "info");
}

export function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    document.getElementById('scan-dropzone')?.classList.add('hidden');
    document.getElementById('scan-preview-img')?.classList.remove('hidden');
    document.getElementById('scan-loading')?.classList.remove('hidden');
    document.getElementById('scan-line-anim')?.classList.remove('hidden');

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = async function() {
            const canvas = document.createElement('canvas');
            const MAX_DIM = 1800;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_DIM) {
                    height = Math.round((height * MAX_DIM) / width);
                    width = MAX_DIM;
                }
            } else {
                if (height > MAX_DIM) {
                    width = Math.round((width * MAX_DIM) / height);
                    height = MAX_DIM;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            const base64Image = canvas.toDataURL('image/jpeg', 0.78);

            scannedPages.push(base64Image);
            activeScanPageIdx = scannedPages.length - 1;
            window.scannedPages = scannedPages;
            window.activeScanPageIdx = activeScanPageIdx;

            const previewImg = document.getElementById('scan-preview-img');
            if (previewImg) previewImg.src = scannedPages[activeScanPageIdx];
            updateScanPagesUI();
            await processWithOpenAI();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}

export function updateScanPagesUI() {
    let pageControls = document.getElementById('scan-pages-controls');
    const previewWrapper = document.getElementById('scan-img-wrapper') || document.getElementById('scan-preview-img');
    if (!pageControls && previewWrapper && previewWrapper.parentElement) {
        pageControls = document.createElement('div');
        pageControls.id = 'scan-pages-controls';
        pageControls.className = 'w-full flex items-center justify-between bg-slate-800 p-2 border-t border-slate-700 z-20';
        previewWrapper.parentElement.appendChild(pageControls);
    }
    if (!pageControls) return;

    pageControls.innerHTML = `
        <div class="flex items-center gap-2">
            <button type="button" onclick="switchScanPage(-1)" class="p-1 bg-slate-700 text-white rounded hover:bg-slate-600 disabled:opacity-50" ${activeScanPageIdx === 0 ? 'disabled' : ''}>
                <i data-lucide="chevron-left" class="w-4 h-4"></i>
            </button>
            <span class="text-xs font-bold text-white">Strana ${activeScanPageIdx + 1} / ${scannedPages.length}</span>
            <button type="button" onclick="switchScanPage(1)" class="p-1 bg-slate-700 text-white rounded hover:bg-slate-600 disabled:opacity-50" ${activeScanPageIdx === scannedPages.length - 1 ? 'disabled' : ''}>
                <i data-lucide="chevron-right" class="w-4 h-4"></i>
            </button>
        </div>
        <label class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-lg cursor-pointer transition flex items-center gap-1 shadow-sm">
            <i data-lucide="plus" class="w-3.5 h-3.5"></i> Další strana
            <input type="file" accept="image/*" capture="environment" class="hidden" onchange="handleFileSelect(event)">
        </label>
    `;
    if (window.lucide) window.lucide.createIcons();
}

export function switchScanPage(dir) {
    if (dir === -1 && activeScanPageIdx > 0) activeScanPageIdx--;
    if (dir === 1 && activeScanPageIdx < scannedPages.length - 1) activeScanPageIdx++;
    window.activeScanPageIdx = activeScanPageIdx;
    const previewImg = document.getElementById('scan-preview-img');
    if (previewImg) previewImg.src = scannedPages[activeScanPageIdx];
    updateScanPagesUI();
}

async function fetchAresSubjectJson(paddedIco) {
    const aresUrl = `https://ares.gov.cz/ekonomicke-subjekty-v-informacnim-systemu/rest/ekonomicke-subjekty/${encodeURIComponent(paddedIco)}`;

    // 1. Pokus o přímé volání ARES API (Simple GET bez custom hlaviček, aby nevznikl CORS preflight OPTIONS blok)
    try {
        const directRes = await fetch(aresUrl);
        if (directRes.status === 404 || directRes.status === 400) {
            return { notFound: true };
        }
        if (directRes.ok) {
            const json = await directRes.json();
            if (json && json.kod && !json.obchodniJmeno) return { notFound: true };
            return { data: json };
        }
    } catch (_) {
        // Přímé volání z prohlížeče zablokováno politikou CORS -> pokračujeme přes CORS proxy fallbacky
    }

    // 2. Fallback přes AllOrigins JSON wrapper (funguje spolehlivě z GitHub Pages i pro 404 odpovědi)
    try {
        const aoRes = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(aresUrl)}`);
        if (aoRes.ok) {
            const wrapper = await aoRes.json();
            const httpCode = wrapper?.status?.http_code;
            if (httpCode === 404 || httpCode === 400) {
                return { notFound: true };
            }
            if (wrapper && wrapper.contents) {
                const parsed = typeof wrapper.contents === 'string' ? JSON.parse(wrapper.contents) : wrapper.contents;
                if (parsed && (parsed.kod === 'NENALEZENO' || (!parsed.obchodniJmeno && parsed.kod))) {
                    return { notFound: true };
                }
                if (parsed && parsed.obchodniJmeno) {
                    return { data: parsed };
                }
            }
        }
    } catch (_) {
        // Pokračujeme na další záložní proxy
    }

    // 3. Fallback přes corsproxy.io
    try {
        const cpRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(aresUrl)}`);
        if (cpRes.status === 404 || cpRes.status === 400) {
            return { notFound: true };
        }
        if (cpRes.ok) {
            const parsed = await cpRes.json();
            if (parsed && (parsed.kod === 'NENALEZENO' || (!parsed.obchodniJmeno && parsed.kod))) {
                return { notFound: true };
            }
            if (parsed && parsed.obchodniJmeno) {
                return { data: parsed };
            }
        }
    } catch (_) {
        // Pokračujeme na další záložní proxy
    }

    // 4. Fallback přes CodeTabs proxy
    const ctRes = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(aresUrl)}`);
    if (ctRes.status === 404 || ctRes.status === 400) {
        return { notFound: true };
    }
    if (ctRes.ok) {
        const parsed = await ctRes.json();
        if (parsed && (parsed.kod === 'NENALEZENO' || (!parsed.obchodniJmeno && parsed.kod))) {
            return { notFound: true };
        }
        return { data: parsed };
    }

    throw new Error('ARES nedostupný');
}

export async function fetchAresData(ico, prefix = 'detail-') {
    const normPrefix = prefix.endsWith('-') ? prefix : `${prefix}-`;
    const cleanIco = String(ico || '').replace(/\D+/g, '').trim();

    if (!cleanIco || cleanIco.length < 7 || cleanIco.length > 8) {
        showToast("Zadejte platné IČO (7–8 číslic) pro ověření v rejstříku ARES.", "warning");
        return null;
    }

    const paddedIco = cleanIco.padStart(8, '0');
    const btnEl = document.getElementById(`btn-ares-${normPrefix}`);
    const originalBtnHtml = btnEl ? btnEl.innerHTML : '';

    if (btnEl) {
        btnEl.disabled = true;
        btnEl.classList.add('opacity-80', 'cursor-wait');
        btnEl.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5 animate-spin"></i><span>ARES...</span>`;
        if (window.lucide) window.lucide.createIcons();
    }

    try {
        const result = await fetchAresSubjectJson(paddedIco);

        if (!result || result.notFound || !result.data) {
            showToast("IČO nenalezeno", "warning");
            return null;
        }

        const data = result.data;
        const obchodniJmeno = data.obchodniJmeno || '';
        const dic = data.dic || '';
        const adresa = data.sidlo?.textovaAdresa || '';

        if (!obchodniJmeno) {
            showToast("IČO nenalezeno", "warning");
            return null;
        }

        const vendorEl = document.getElementById(`${normPrefix}vendor`);
        const dicEl = document.getElementById(`${normPrefix}dic`);
        const icoEl = document.getElementById(`${normPrefix}ico`);

        if (vendorEl) {
            vendorEl.value = obchodniJmeno;
            vendorEl.classList.add('ring-2', 'ring-emerald-500');
            setTimeout(() => vendorEl.classList.remove('ring-2', 'ring-emerald-500'), 1400);
        }
        if (dicEl && dic) {
            dicEl.value = dic;
            dicEl.classList.add('ring-2', 'ring-emerald-500');
            setTimeout(() => dicEl.classList.remove('ring-2', 'ring-emerald-500'), 1400);
        }
        if (icoEl) {
            icoEl.value = data.ico || paddedIco;
        }

        showToast(`Firma nalezena: ${obchodniJmeno}${dic ? ' (' + dic + ')' : ''}`, "success");
        return { obchodniJmeno, dic, adresa, ico: data.ico || paddedIco };
    } catch (err) {
        console.warn("Chyba při komunikaci s ARES API:", err);
        showToast("Nepodařilo se spojit s rejstříkem ARES.", "warning");
        return null;
    } finally {
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.classList.remove('opacity-80', 'cursor-wait');
            btnEl.innerHTML = originalBtnHtml;
            if (window.lucide) window.lucide.createIcons();
        }
    }
}

export async function verifyAresFromInput(prefix = 'detail-') {
    const normPrefix = prefix.endsWith('-') ? prefix : `${prefix}-`;
    const icoInput = document.getElementById(`${normPrefix}ico`);
    const icoVal = icoInput ? icoInput.value : '';
    const res = await fetchAresData(icoVal, normPrefix);

    if (res && normPrefix === 'field-') {
        const getVal = (id) => document.getElementById(id) ? document.getElementById(id).value : '';
        renderAiOverlayElements(
            'scan-ai-overlay',
            'scan-ai-highlights-bar',
            {
                vendor: getVal('field-vendor'),
                ico: getVal('field-ico'),
                invoiceNumber: getVal('field-invoice-num') || getVal('field-vs'),
                dateIssue: getVal('field-date-issue'),
                amount: getVal('field-amount'),
                accountNumber: getVal('field-account')
            },
            lastExtractedAiOverlay,
            'scan'
        );
    } else if (res && normPrefix === 'detail-') {
        const getVal = (id) => document.getElementById(id) ? document.getElementById(id).value : '';
        renderAiOverlayElements(
            'detail-ai-overlay',
            'detail-ai-legend',
            {
                vendor: getVal('detail-vendor'),
                ico: getVal('detail-ico'),
                invoiceNumber: getVal('detail-invoice-num') || getVal('detail-vs'),
                dateIssue: getVal('detail-due-issue'),
                amount: getVal('detail-amount'),
                accountNumber: getVal('detail-account')
            },
            null,
            'detail'
        );
    }
    return res;
}

export async function processWithOpenAI() {
    if (!scannedPages || scannedPages.length === 0) return;

    let apiKey = localStorage.getItem('openai_key');
    if (!apiKey) {
        apiKey = prompt("Pro reálné skenování vložte váš OpenAI API klíč (začíná na sk-...):");
        if (!apiKey) {
            alert("Skenování zrušeno. Bez klíče nelze data z faktury přečíst.");
            closeModal('scan-modal');
            return;
        }
        localStorage.setItem('openai_key', apiKey);
    }

    const scanLoading = document.getElementById('scan-loading');
    const loadingText = scanLoading ? scanLoading.querySelector('p.font-bold') : null;
    if (scanLoading) scanLoading.classList.remove('hidden');
    document.getElementById('scan-line-anim')?.classList.remove('hidden');
    if (loadingText) loadingText.textContent = "AI analyzuje strukturu dokladu a pozice údajů...";

    try {
        const systemPrompt = `Jsi profesionální účetní expert pro extrakci dat z českých a slovenských faktur.
Tvojí úlohou je přesně analyzovat vícestránkový dokument a vrátit data striktně ve formátu JSON.
Při hledání údajů postupuj podle těchto pravidel:
- 'vendor': Název dodavatele.
- 'invoiceNumber': Číslo faktury se může jmenovat: "Faktura č.", "Číslo dokladu", "č.fakt.", "Daňový doklad č.".
- 'vs': Variabilní symbol hledej jako "V.S.", "Var. symbol", "Variabilní symbol". Pokud prokazatelně chybí, vlož sem pouze číslice ze samotného čísla faktury.
- 'ico': IČO hledej jako "IČ", "IČO", "Identifikační číslo" (odstraň mezery, vrať jen čísla).
- 'dateIssue', 'dateTax', 'dateDue': Všechna data vrať striktně ve formátu YYYY-MM-DD. Pokud DUZP (dateTax) chybí, použij datum vystavení (dateIssue).
- 'baseAmount', 'vatRate', 'vatAmount', 'amount': Všechny částky vracej jako čisté číslo s desetinnou tečkou (žádné mezery a žádné "Kč" nebo "EUR", např. 1500.50). Celkovou částku hledej jako "Celkem k úhradě", "K platbě". 'vatRate' jako číslo 21, 12 nebo 0.
- 'paymentMethod': Vyber přesně jednu hodnotu: 'Převodem', 'Kartou', 'Hotově', 'Zápočtem', 'Dobírka'.
- 'account': Číslo bankovního účtu včetně kódu banky (např. 123456789/0100) nebo IBAN.
- 'boundingBoxes': Objekt s přibližnými souřadnicemi středu nalezeného textu v procentech (x: 5 až 95 zleva doprava, y: 5 až 95 shora dolů) na první stránce dokumentu pro klíče:
  "vendor": {"x": číslo, "y": číslo},
  "ico": {"x": číslo, "y": číslo},
  "invoiceNumber": {"x": číslo, "y": číslo},
  "dateIssue": {"x": číslo, "y": číslo},
  "amount": {"x": číslo, "y": číslo},
  "account": {"x": číslo, "y": číslo}.`;

        const contentArray = [{ type: "text", text: "Vytáhni data a přibližné procentuální souřadnice (boundingBoxes) z této faktury do JSON." }];
        scannedPages.forEach(pageB64 => {
            contentArray.push({ type: "image_url", image_url: { url: pageB64 } });
        });

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: contentArray }
                ]
            })
        });

        const data = await response.json();
        if (data.choices && data.choices[0]) {
            const parsed = JSON.parse(data.choices[0].message.content);
            const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };

            setVal('field-vendor', parsed.vendor);
            setVal('field-ico', parsed.ico);
            setVal('field-dic', parsed.dic || '');
            setVal('field-invoice-num', parsed.invoiceNumber || parsed.vs);
            setVal('field-vs', parsed.vs || parsed.invoiceNumber);
            setVal('field-date-issue', parsed.dateIssue);
            setVal('field-date-tax', parsed.dateTax || parsed.dateIssue);
            setVal('field-date-due', parsed.dateDue || parsed.dateIssue);
            setVal('field-base-amount', parsed.baseAmount);
            setVal('field-vat-rate', parsed.vatRate || "21");
            setVal('field-vat-amount', parsed.vatAmount);
            setVal('field-amount', parsed.amount);
            setVal('field-payment-method', parsed.paymentMethod || "Převodem");
            setVal('field-account', parsed.account);

            calculateScanAmounts('total');

            // Automatické ověření a doplnění přesného názvu firmy + DIČ z rejstříku ARES podle vyčteného IČO
            if (parsed.ico && String(parsed.ico).replace(/\D+/g, '').length >= 7) {
                await fetchAresData(parsed.ico, 'field-');
            }

            const finalVendor = document.getElementById('field-vendor')?.value || parsed.vendor;
            const finalIco = document.getElementById('field-ico')?.value || parsed.ico;

            lastExtractedAiOverlay = normalizeAiOverlayCoords(parsed.boundingBoxes);
            scanOverlayVisible = true;
            const scanOverlayEl = document.getElementById('scan-ai-overlay');
            if (scanOverlayEl) scanOverlayEl.classList.remove('hidden');

            renderAiOverlayElements(
                'scan-ai-overlay',
                'scan-ai-highlights-bar',
                {
                    vendor: finalVendor,
                    ico: finalIco,
                    invoiceNumber: parsed.invoiceNumber || parsed.vs,
                    dateIssue: parsed.dateIssue,
                    amount: parsed.amount,
                    accountNumber: parsed.account
                },
                lastExtractedAiOverlay,
                'scan'
            );

            showToast("Faktura úspěšně přečtena včetně pozic údajů!", "success");
        } else {
            alert("AI nemohla fakturu přečíst. Zkuste to znovu.");
        }
    } catch (err) {
        alert("Chyba při komunikaci s AI. Pokud chyba přetrvává, zkontrolujte svůj API klíč.");
        localStorage.removeItem('openai_key');
    } finally {
        if (scanLoading) scanLoading.classList.add('hidden');
        document.getElementById('scan-line-anim')?.classList.add('hidden');
    }
}

export async function saveExtractedInvoice(e) {
    e.preventDefault();
    if (!scannedPages || scannedPages.length === 0) {
        showToast("Není naskenována žádná faktura.", "warning");
        return;
    }

    const user = auth.currentUser || currentUser;
    const chosenClient = (currentRole === 'client')
        ? activeClientCompany
        : (document.getElementById('field-client-name')?.value || activeClientCompany || 'Moje Firma');

    const scanLoading = document.getElementById('scan-loading');
    const loadingText = scanLoading ? scanLoading.querySelector('p.font-bold') : null;
    if (scanLoading) scanLoading.classList.remove('hidden');
    if (loadingText) loadingText.textContent = `Nahrávám ${scannedPages.length} stran do cloudu...`;

    try {
        const uploadedUrls = [];
        if (window.isDemoMode) {
            scannedPages.forEach(p => uploadedUrls.push(p));
        } else {
            for (let i = 0; i < scannedPages.length; i++) {
                const base64Data = scannedPages[i];
                const fileName = `invoices/${user ? user.uid : 'anon'}/${Date.now()}_page_${i + 1}.jpg`;
                const storageRef = ref(storage, fileName);
                await uploadString(storageRef, base64Data, 'data_url');
                uploadedUrls.push(await getDownloadURL(storageRef));
            }
        }

        const getVal = (id) => document.getElementById(id) ? document.getElementById(id).value : '';
        const extractedFields = {
            clientName: chosenClient,
            vendor: getVal('field-vendor') || 'Neznámý dodavatel',
            ico: getVal('field-ico'),
            dic: getVal('field-dic'),
            invoiceNumber: getVal('field-invoice-num'),
            vs: getVal('field-vs') || getVal('field-invoice-num'),
            type: getVal('field-type') || 'Přijatá faktura',
            paymentMethod: getVal('field-payment-method') || 'Převodem',
            dateIssue: getVal('field-date-issue'),
            dateTax: getVal('field-date-tax') || getVal('field-date-issue'),
            dateDue: getVal('field-date-due'),
            baseAmount: parseFloat(getVal('field-base-amount')) || 0,
            vatRate: getVal('field-vat-rate') || '21',
            vatAmount: parseFloat(getVal('field-vat-amount')) || 0,
            amount: parseFloat(getVal('field-amount')) || 0,
            accountNumber: getVal('field-account'),
            imgUrl: uploadedUrls[0] || '',
            imgUrls: uploadedUrls,
            aiOverlay: lastExtractedAiOverlay || DEFAULT_AI_COORDS
        };

        // Pokud probíhá RESCAN existujícího dokladu -> provedeme updateDoc místo addDoc
        const targetRescanId = rescanningInvoiceId || window.rescanningInvoiceId;
        if (targetRescanId) {
            const updatePayload = {
                ...extractedFields,
                updatedAt: new Date().toISOString()
            };

            if (!window.isDemoMode) {
                await updateDoc(doc(db, "invoices", targetRescanId), updatePayload);
            }

            if (typeof window.handleRescanCompleted === 'function') {
                window.handleRescanCompleted(targetRescanId, updatePayload);
            }

            rescanningInvoiceId = null;
            window.rescanningInvoiceId = null;
            scannedPages = [];
            window.scannedPages = [];
            closeModal('scan-modal');
            showToast("Doklad byl úspěšně přepsán novým skenem!", "success");
            return;
        }

        // Standardní vytvoření nového dokladu
        const newInvoice = {
            ...extractedFields,
            userId: user ? user.uid : 'demo-user',
            userEmail: user ? user.email : 'demo@demo.cz',
            accountantId: (currentRole === 'accountant' && user) ? user.uid : (currentUserData?.accountantId || 'demo'),
            isDemo: window.isDemoMode,
            status: 'pending',
            note: '',
            createdAt: new Date().toISOString()
        };

        if (!window.isDemoMode) {
            await addDoc(collection(db, "invoices"), newInvoice);
        } else if (typeof window.handleDemoInvoiceAdded === 'function') {
            window.handleDemoInvoiceAdded({ id: 'INV-' + Math.floor(1000 + Math.random() * 9000), ...newInvoice });
        }

        closeModal('scan-modal');
        showToast(`Doklad uložen! Naskenováno stran: ${uploadedUrls.length}`, "success");
        scannedPages = [];
        window.scannedPages = [];
    } catch (err) {
        console.error("Chyba při zápisu do cloudu:", err);
        alert("CHYBA UKLÁDÁNÍ DO FIREBASE:\n" + err.message + "\n\nZkontrolujte, zda máte povolený Firebase Storage!");
    } finally {
        if (scanLoading) scanLoading.classList.add('hidden');
        if (loadingText) loadingText.textContent = "AI analyzuje strukturu dokladu...";
    }
}

// Navázání na window pro přímé volání z HTML
window.triggerScan = triggerScan;
window.startRescanForInvoice = startRescanForInvoice;
window.handleFileSelect = handleFileSelect;
window.switchScanPage = switchScanPage;
window.updateScanPagesUI = updateScanPagesUI;
window.processWithOpenAI = processWithOpenAI;
window.saveExtractedInvoice = saveExtractedInvoice;
window.calculateScanAmounts = calculateScanAmounts;
window.focusAiField = focusAiField;
window.toggleScanAiOverlay = toggleScanAiOverlay;
window.fetchAresData = fetchAresData;
window.verifyAresFromInput = verifyAresFromInput;

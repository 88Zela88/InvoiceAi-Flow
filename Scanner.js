import { db, storage, auth } from './firebase.js';
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-storage.js";
import { openModal, closeModal, showToast } from './ui.js';

window.scannedPages = [];
window.activeScanPageIdx = 0;

export function triggerScan() {
    window.scannedPages = [];
    window.activeScanPageIdx = 0;
    
    document.getElementById('scan-preview-img').src = '';
    document.getElementById('scan-dropzone').classList.remove('hidden');
    document.getElementById('scan-preview-img').classList.add('hidden');
    document.getElementById('scan-loading').classList.add('hidden');
    document.getElementById('scan-line-anim').classList.add('hidden');
    
    const pageControls = document.getElementById('scan-pages-controls');
    if (pageControls) pageControls.remove();
    
    openModal('scan-modal');
}

export function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    document.getElementById('scan-dropzone').classList.add('hidden');
    document.getElementById('scan-preview-img').classList.remove('hidden');
    document.getElementById('scan-loading').classList.remove('hidden');
    document.getElementById('scan-line-anim').classList.remove('hidden');

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
            window.scannedPages.push(base64Image);
            window.activeScanPageIdx = window.scannedPages.length - 1;
            
            document.getElementById('scan-preview-img').src = window.scannedPages[window.activeScanPageIdx];
            updateScanPagesUI();
            await processWithOpenAI();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

export function updateScanPagesUI() {
    let pageControls = document.getElementById('scan-pages-controls');
    if (!pageControls) {
        pageControls = document.createElement('div');
        pageControls.id = 'scan-pages-controls';
        pageControls.className = 'w-full flex items-center justify-between bg-slate-800 p-2 border-t border-slate-700';
        const previewContainer = document.getElementById('scan-preview-img').parentElement;
        previewContainer.appendChild(pageControls);
    }
    
    pageControls.innerHTML = `
        <div class="flex items-center gap-2">
            <button type="button" onclick="switchScanPage(-1)" class="p-1 bg-slate-700 text-white rounded hover:bg-slate-600 disabled:opacity-50" ${window.activeScanPageIdx === 0 ? 'disabled' : ''}>
                <i data-lucide="chevron-left" class="w-4 h-4"></i>
            </button>
            <span class="text-xs font-bold text-white">Strana ${window.activeScanPageIdx + 1} / ${window.scannedPages.length}</span>
            <button type="button" onclick="switchScanPage(1)" class="p-1 bg-slate-700 text-white rounded hover:bg-slate-600 disabled:opacity-50" ${window.activeScanPageIdx === window.scannedPages.length - 1 ? 'disabled' : ''}>
                <i data-lucide="chevron-right" class="w-4 h-4"></i>
            </button>
        </div>
        <label class="px-3 py-1.5 bg-emerald-600 hover:bg-blue-700 text-white text-[11px] font-bold rounded-lg cursor-pointer transition flex items-center gap-1 shadow-sm">
            <i data-lucide="plus" class="w-3.5 h-3.5"></i> Další strana
            <input type="file" accept="image/*" capture="environment" class="hidden" onchange="handleFileSelect(event)">
        </label>
    `;
    if(window.lucide) window.lucide.createIcons();
}

export function switchScanPage(dir) {
    if (dir === -1 && window.activeScanPageIdx > 0) window.activeScanPageIdx--;
    if (dir === 1 && window.activeScanPageIdx < window.scannedPages.length - 1) window.activeScanPageIdx++;
    
    document.getElementById('scan-preview-img').src = window.scannedPages[window.activeScanPageIdx];
    updateScanPagesUI();
}

export async function processWithOpenAI() {
    if (!window.scannedPages || window.scannedPages.length === 0) return;

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
    document.getElementById('scan-line-anim').classList.remove('hidden');
    if (loadingText) loadingText.textContent = "AI analyzuje strukturu dokladu...";

    try {
        const contentArray = [
            {
                type: "text",
                text: "Vytáhni data z této vícestránkové faktury přesně do JSON s klíči: 'vendor', 'ico', 'invoiceNumber', 'vs', 'dateIssue', 'dateTax', 'dateDue', 'baseAmount', 'vatRate', 'vatAmount', 'amount', 'paymentMethod', 'account'."
            }
        ];

        window.scannedPages.forEach(pageB64 => {
            contentArray.push({ type: "image_url", image_url: { url: pageB64 } });
        });

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                response_format: { type: "json_object" },
                messages: [{ role: "user", content: contentArray }]
            })
        });

        const data = await response.json();
        if (data.choices && data.choices[0]) {
            const parsed = JSON.parse(data.choices[0].message.content);
            document.getElementById('field-vendor').value = parsed.vendor || "";
            document.getElementById('field-ico').value = parsed.ico || "";
            document.getElementById('field-invoice-num').value = parsed.invoiceNumber || parsed.vs || "";
            document.getElementById('field-vs').value = parsed.vs || parsed.invoiceNumber || "";
            document.getElementById('field-date-issue').value = parsed.dateIssue || "";
            document.getElementById('field-date-tax').value = parsed.dateTax || parsed.dateIssue || "";
            document.getElementById('field-date-due').value = parsed.dateDue || parsed.dateIssue || "";
            document.getElementById('field-base-amount').value = parsed.baseAmount || "";
            document.getElementById('field-vat-rate').value = parsed.vatRate || "21";
            document.getElementById('field-vat-amount').value = parsed.vatAmount || "";
            document.getElementById('field-amount').value = parsed.amount || "";
            document.getElementById('field-payment-method').value = parsed.paymentMethod || "Převodem";
            document.getElementById('field-account').value = parsed.account || "";

            calculateScanAmounts();
            showToast("Faktura úspěšně přečtena!", "success");
        } else {
            alert("AI nemohla fakturu přečíst. Zkuste to znovu.");
        }
    } catch (err) {
        alert("Chyba při komunikaci s AI. Pokud chyba přetrvává, zkontrolujte svůj API klíč.");
        localStorage.removeItem('openai_key');
    } finally {
        if (scanLoading) scanLoading.classList.add('hidden');
        document.getElementById('scan-line-anim').classList.add('hidden');
    }
}

export async function saveExtractedInvoice(e) {
    e.preventDefault();
    if (!window.scannedPages || window.scannedPages.length === 0) {
        showToast("Není naskenována žádná faktura.", "warning");
        return;
    }

    const user = auth.currentUser || window.currentUser;
    const chosenClient = (window.currentRole === 'client') ? window.activeClientCompany : (document.getElementById('detail-client-select')?.value || window.activeClientCompany || 'Moje Firma');

    const scanLoading = document.getElementById('scan-loading');
    const loadingText = scanLoading ? scanLoading.querySelector('p.font-bold') : null;
    if (scanLoading) scanLoading.classList.remove('hidden');
    if (loadingText) loadingText.textContent = `Nahrávám ${window.scannedPages.length} stran do cloudu...`;

    try {
        const uploadedUrls = [];
        if (window.isDemoMode) {
            window.scannedPages.forEach(p => uploadedUrls.push(p));
        } else {
            for (let i = 0; i < window.scannedPages.length; i++) {
                const base64Data = window.scannedPages[i];
                const fileName = `invoices/${user.uid}/${Date.now()}_page_${i + 1}.jpg`;
                const storageRef = ref(storage, fileName);
                
                await uploadString(storageRef, base64Data, 'data_url');
                const downloadUrl = await getDownloadURL(storageRef);
                uploadedUrls.push(downloadUrl);
            }
        }

        const newInvoice = {
            clientName: chosenClient,
            userId: user ? user.uid : 'demo-user',
            userEmail: user ? user.email : 'demo@demo.cz',
            accountantId: (window.currentRole === 'accountant' && user) ? user.uid : (window.currentUserData?.accountantId || 'demo'),
            isDemo: window.isDemoMode,
            vendor: document.getElementById('field-vendor').value || 'Neznámý dodavatel',
            ico: document.getElementById('field-ico').value || '',
            invoiceNumber: document.getElementById('field-invoice-num').value || '',
            vs: document.getElementById('field-vs').value || '',
            type: document.getElementById('field-type').value || 'Přijatá faktura',
            paymentMethod: document.getElementById('field-payment-method').value || 'Převodem',
            dateIssue: document.getElementById('field-date-issue').value || '',
            dateTax: document.getElementById('field-date-tax').value || '',
            dateDue: document.getElementById('field-date-due').value || '',
            baseAmount: parseFloat(document.getElementById('field-base-amount').value) || 0,
            vatRate: document.getElementById('field-vat-rate').value || '21',
            vatAmount: parseFloat(document.getElementById('field-vat-amount').value) || 0,
            amount: parseFloat(document.getElementById('field-amount').value) || 0,
            accountNumber: document.getElementById('field-account').value || '',
            status: 'pending',
            note: '',
            imgUrl: uploadedUrls[0] || '',
            imgUrls: uploadedUrls,
            createdAt: new Date().toISOString()
        };

        await addDoc(collection(db, "invoices"), newInvoice);
        closeModal('scan-modal');
        showToast(`Doklad uložen! Naskenováno stran: ${uploadedUrls.length}`, "success");
        window.scannedPages = [];
    } catch (err) {
        alert("CHYBA UKLÁDÁNÍ DO FIREBASE:\n" + err.message);
    } finally {
        if (scanLoading) scanLoading.classList.add('hidden');
        if (loadingText) loadingText.textContent = "AI analyzuje strukturu dokladu..."; 
    }
}

export function calculateScanAmounts() {
    const baseInput = document.getElementById('field-base-amount');
    const vatInput = document.getElementById('field-vat-amount');
    const totalInput = document.getElementById('field-amount');
    const rateSelect = document.getElementById('field-vat-rate');
    if (!baseInput || !vatInput || !totalInput || !rateSelect) return;
    
    const rate = parseFloat(rateSelect.value) || 0;
    const total = parseFloat(totalInput.value) || 0;
    if (total > 0) {
        const base = rate === 0 ? total : Math.round((total / (1 + (rate / 100))) * 100) / 100;
        baseInput.value = base.toFixed(2);
        vatInput.value = (total - base).toFixed(2);
    }
}

export function calculateDetailAmounts() {
    const baseInput = document.getElementById('detail-base-amount');
    const vatInput = document.getElementById('detail-vat-amount');
    const totalInput = document.getElementById('detail-amount');
    const rateSelect = document.getElementById('detail-vat');
    if (!baseInput || !vatInput || !totalInput || !rateSelect) return;
    
    const rate = parseFloat(rateSelect.value) || 0;
    const total = parseFloat(totalInput.value) || 0;
    if (total > 0) {
        const base = rate === 0 ? total : Math.round((total / (1 + (rate / 100))) * 100) / 100;
        baseInput.value = base.toFixed(2);
        vatInput.value = (total - base).toFixed(2);
    }
}
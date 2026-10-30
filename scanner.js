import { db, storage } from './firebase.js';
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-storage.js";
import { showToast, closeModal, openModal } from './ui.js';
import { auth, currentUserData, activeClientCompany, currentRole } from './auth.js';

export let scannedPages = [];
export let activeScanPageIdx = 0;

export function triggerScan() {
    scannedPages = [];
    activeScanPageIdx = 0;
    
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
            
            scannedPages.push(base64Image);
            activeScanPageIdx = scannedPages.length - 1;
            
            document.getElementById('scan-preview-img').src = scannedPages[activeScanPageIdx];
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
        document.getElementById('scan-preview-img').parentElement.appendChild(pageControls);
    }
    
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
    if(window.lucide) window.lucide.createIcons();
}

export function switchScanPage(dir) {
    if (dir === -1 && activeScanPageIdx > 0) activeScanPageIdx--;
    if (dir === 1 && activeScanPageIdx < scannedPages.length - 1) activeScanPageIdx++;
    document.getElementById('scan-preview-img').src = scannedPages[activeScanPageIdx];
    updateScanPagesUI();
}

export async function processWithOpenAI() {
    if (!scannedPages || scannedPages.length === 0) return;

    let apiKey = localStorage.getItem('openai_key');
    if (!apiKey) {
        apiKey = prompt("Vložte váš OpenAI API klíč:");
        if (!apiKey) {
            alert("Zrušeno.");
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
        const systemPrompt = `Jsi profesionální účetní expert pro extrakci dat z českých a slovenských faktur.
Tvojí úlohou je přesně analyzovat vícestránkový dokument a vrátit data striktně ve formátu JSON.
Při hledání údajů postupuj podle těchto pravidel:
- 'invoiceNumber': Číslo faktury se může jmenovat: "Faktura č.", "Číslo dokladu", "č.fakt.", "Daňový doklad č.".
- 'vs': Variabilní symbol hledej jako "V.S.", "Var. symbol", "Variabilní symbol". Pokud prokazatelně chybí, vlož sem pouze číslice ze samotného čísla faktury.
- 'ico': IČO hledej jako "IČ", "IČO", "Identifikační číslo" (odstraň mezery, vrať jen čísla).
- 'dateIssue', 'dateTax', 'dateDue': Všechna data vrať striktně ve formátu YYYY-MM-DD. Pokud DUZP (dateTax) chybí, použij datum vystavení (dateIssue).
- 'baseAmount', 'vatAmount', 'amount': Všechny částky vracej jako čisté číslo s desetinnou tečkou (žádné mezery a žádné "Kč" nebo "EUR", např. 1500.50). Celkovou částku hledej jako "Celkem k úhradě", "K platbě".
- 'paymentMethod': Vyber přesně jednu hodnotu: 'Převodem', 'Kartou', 'Hotově', 'Zápočtem', 'Dobírka'.
- 'account': Číslo bankovního účtu včetně kódu banky (např. 123456789/0100) nebo IBAN.`;

        const contentArray = [{ type: "text", text: "Vytáhni data z této faktury do JSON." }];
        scannedPages.forEach(pageB64 => { contentArray.push({ type: "image_url", image_url: { url: pageB64 } }); });

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                response_format: { type: "json_object" },
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: contentArray }]
            })
        });

        const data = await response.json();
        if (data.choices && data.choices[0]) {
            const parsed = JSON.parse(data.choices[0].message.content);
            const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
            
            setVal('field-vendor', parsed.vendor);
            setVal('field-ico', parsed.ico);
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

            if(window.calculateScanAmounts) window.calculateScanAmounts();
            showToast("Faktura úspěšně přečtena!", "success");
        } else {
            alert("AI nemohla fakturu přečíst.");
        }
    } catch (err) {
        alert("Chyba při komunikaci s AI.");
        localStorage.removeItem('openai_key');
    } finally {
        if (scanLoading) scanLoading.classList.add('hidden');
        document.getElementById('scan-line-anim').classList.add('hidden');
    }
}

export async function saveExtractedInvoice(e) {
    e.preventDefault();
    if (!scannedPages || scannedPages.length === 0) return showToast("Není naskenována žádná faktura.", "warning");

    const user = auth.currentUser;
    const chosenClient = (currentRole === 'client') ? activeClientCompany : (document.getElementById('field-client-name')?.value || activeClientCompany || 'Moje Firma');

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
                const fileName = `invoices/${user.uid}/${Date.now()}_page_${i + 1}.jpg`;
                const storageRef = ref(storage, fileName);
                await uploadString(storageRef, base64Data, 'data_url');
                uploadedUrls.push(await getDownloadURL(storageRef));
            }
        }

        const getVal = (id) => document.getElementById(id) ? document.getElementById(id).value : '';
        const newInvoice = {
            clientName: chosenClient,
            userId: user ? user.uid : 'demo-user',
            userEmail: user ? user.email : 'demo@demo.cz',
            accountantId: (currentRole === 'accountant' && user) ? user.uid : (currentUserData?.accountantId || 'demo'),
            isDemo: window.isDemoMode,
            vendor: getVal('field-vendor') || 'Neznámý dodavatel',
            ico: getVal('field-ico'),
            invoiceNumber: getVal('field-invoice-num'),
            vs: getVal('field-vs'),
            type: getVal('field-type') || 'Přijatá faktura',
            paymentMethod: getVal('field-payment-method') || 'Převodem',
            dateIssue: getVal('field-date-issue'),
            dateTax: getVal('field-date-tax'),
            dateDue: getVal('field-date-due'),
            baseAmount: parseFloat(getVal('field-base-amount')) || 0,
            vatRate: getVal('field-vat-rate') || '21',
            vatAmount: parseFloat(getVal('field-vat-amount')) || 0,
            amount: parseFloat(getVal('field-amount')) || 0,
            accountNumber: getVal('field-account'),
            status: 'pending',
            note: '',
            imgUrl: uploadedUrls[0] || '',
            imgUrls: uploadedUrls,
            createdAt: new Date().toISOString()
        };

        await addDoc(collection(db, "invoices"), newInvoice);
        closeModal('scan-modal');
        showToast(`Doklad uložen! Naskenováno stran: ${uploadedUrls.length}`, "success");
        scannedPages = [];
    } catch (err) {
        alert("CHYBA UKLÁDÁNÍ DO FIREBASE:\n" + err.message);
    } finally {
        if (scanLoading) scanLoading.classList.add('hidden');
        if (loadingText) loadingText.textContent = "AI analyzuje strukturu dokladu..."; 
    }
}
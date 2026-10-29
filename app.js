// FINÁLNÍ VYČIŠTĚNÁ VERZE app.js (Storage, vícestránkový scan, fullscreen křížek)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc, setDoc, getDoc, query, orderBy, getDocs, where } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword, sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { getStorage, ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyCAx_UsY1kCL01fobO6fWkXpbLC93XF1Vo",
    authDomain: "invoiceai-flow.firebaseapp.com",
    projectId: "invoiceai-flow",
    storageBucket: "invoiceai-flow.firebasestorage.app",
    messagingSenderId: "242344344796",
    appId: "1:242344344796:web:7c2d5f10a5ca4b40d04819",
    measurementId: "G-ZESE0H37N4"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

let currentUser = null;
let currentUserData = null;
let currentRole = 'client';
let activeClientCompany = 'Moje Firma s.r.o.';
let activeAccountantCompany = 'Účetní kancelář';
let selectedInvoiceId = null;
let selectedClientIdForModal = null;
let invoices = [];
let currentClientFilter = 'all';
let authMode = 'signin';
window.isDemoMode = false;

// Stavy pro listování
window.scannedPages = [];
window.activeScanPageIdx = 0;
window.currentInvoicePages = [];
window.activeDetailPageIdx = 0;
let detailZoom = 1;
let detailRotation = 0;

const invoicesQuery = query(collection(db, "invoices"), orderBy("createdAt", "desc"));
onSnapshot(invoicesQuery, (snapshot) => {
    invoices = [];
    snapshot.forEach((docSnap) => {
        invoices.push({ id: docSnap.id, ...docSnap.data() });
    });
    updateDynamicClients();
    renderClientInvoices();
    renderAccountantInvoices();
}, (error) => {
    console.error("Chyba při čtení z Firestore:", error);
    showToast("Chyba synchronizace databáze: " + error.message, "warning");
});

function formatDateTime(isoString) {
    if (!isoString) return '-';
    try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return isoString;
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        const hours = String(d.getHours()).padStart(2, '0');
        const mins = String(d.getMinutes()).padStart(2, '0');
        return `${day}.${month}.${year} ${hours}:${mins}`;
    } catch {
        return isoString;
    }
}

function checkDateMatch(inv, preset, fromDate, toDate) {
    if (!preset || preset === 'all') return true;
    let d = null;
    if (inv.createdAt) d = new Date(inv.createdAt);
    else if (inv.dateIssue) d = new Date(inv.dateIssue);
    
    if (!d || isNaN(d.getTime())) return true;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (preset === 'today') return dDate.getTime() === startOfToday.getTime();
    if (preset === 'week') {
        const sevenDaysAgo = new Date(startOfToday.getTime() - (7 * 24 * 60 * 60 * 1000));
        return dDate >= sevenDaysAgo && dDate <= now;
    }
    if (preset === 'this_month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (preset === 'last_month') {
        const lastMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
        const lastMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
        return d.getFullYear() === lastMonthYear && d.getMonth() === lastMonth;
    }
    if (preset === 'custom') {
        if (fromDate) {
            const f = new Date(fromDate);
            f.setHours(0, 0, 0, 0);
            if (d < f) return false;
        }
        if (toDate) {
            const t = new Date(toDate);
            t.setHours(23, 59, 59, 999);
            if (d > t) return false;
        }
        return true;
    }
    return true;
}

// ================= FIREBASE AUTHENTICATION LOGIKA =================
onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    const landingPage = document.getElementById('landing-page');
    const appContainer = document.getElementById('app');
    const demoSwitcher = document.getElementById('demo-switcher-container');

    if (user) {
        window.isDemoMode = false;
        if (landingPage) landingPage.classList.add('hidden');
        if (appContainer) appContainer.classList.remove('hidden');
        if (demoSwitcher) demoSwitcher.classList.add('hidden');

        document.getElementById('user-display-email').textContent = user.email || 'Přihlášený uživatel';
        document.getElementById('menu-user-email').textContent = user.email || 'Přihlášený uživatel';
        document.getElementById('user-avatar').textContent = (user.email ? user.email[0].toUpperCase() : 'U');

        try {
            const userDocRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userDocRef);
            if (userSnap.exists()) {
                currentUserData = userSnap.data();
                currentRole = currentUserData.role || 'client';
                if (currentUserData.company) {
                    if (currentRole === 'client') {
                        activeClientCompany = currentUserData.company;
                        const badge = document.getElementById('current-client-badge');
                        if (badge) badge.textContent = `Firma: ${activeClientCompany}`;
                    } else {
                        activeAccountantCompany = currentUserData.company;
                        const accBadge = document.getElementById('acc-agency-badge');
                        if (accBadge) accBadge.textContent = `Účetní kancelář: ${activeAccountantCompany}`;
                    }
                }
            }
        } catch (e) {
            console.warn("Profil uživatele nebyl načten:", e);
        }

        const roleDisplay = currentRole === 'accountant' ? (activeAccountantCompany || 'Účetní kancelář') : `Klient (${activeClientCompany})`;
        document.getElementById('user-display-role').textContent = roleDisplay;
        document.getElementById('menu-user-company').textContent = roleDisplay;

        if (currentRole === 'client') {
            switchRole('client');
        } else {
            switchRole('accountant');
        }

        showToast(`Vítejte zpět, ${user.email}!`, "success");
    } else {
        if (!window.isDemoMode) {
            if (landingPage) landingPage.classList.remove('hidden');
            if (appContainer) appContainer.classList.add('hidden');
        }
    }
    updateDynamicClients();
    renderClientsModalTable();
    renderClientInvoices();
    renderAccountantInvoices();
});

function switchRole(role) {
    currentRole = role;
    const clientView = document.getElementById('client-view');
    const accountantView = document.getElementById('accountant-view');
    const btnClient = document.getElementById('role-btn-client');
    const btnAcc = document.getElementById('role-btn-accountant');

    if (role === 'client') {
        if (clientView) clientView.classList.remove('hidden');
        if (accountantView) accountantView.classList.add('hidden');
        if (btnClient) btnClient.className = "px-2.5 py-1 rounded-lg text-xs font-semibold transition bg-blue-600 text-white";
        if (btnAcc) btnAcc.className = "px-2.5 py-1 rounded-lg text-xs font-semibold transition text-slate-400 hover:text-white";
        renderClientInvoices();
    } else {
        if (clientView) clientView.classList.add('hidden');
        if (accountantView) accountantView.classList.remove('hidden');
        if (btnAcc) btnAcc.className = "px-2.5 py-1 rounded-lg text-xs font-semibold transition bg-blue-600 text-white";
        if (btnClient) btnClient.className = "px-2.5 py-1 rounded-lg text-xs font-semibold transition text-slate-400 hover:text-white";
        renderAccountantInvoices();
    }
}

// ================= SKENOVÁNÍ VÍCE STRAN =================
function triggerScan() {
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

function handleFileSelect(event) {
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
            // Rozlišení 1800 px
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
            
            // Přidání do pole naskenovaných stran
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

function updateScanPagesUI() {
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
        <label class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold rounded-lg cursor-pointer transition flex items-center gap-1 shadow-sm">
            <i data-lucide="plus" class="w-3.5 h-3.5"></i> Další strana
            <input type="file" accept="image/*" capture="environment" class="hidden" onchange="handleFileSelect(event)">
        </label>
    `;
    if(window.lucide) window.lucide.createIcons();
}

function switchScanPage(dir) {
    if (dir === -1 && window.activeScanPageIdx > 0) window.activeScanPageIdx--;
    if (dir === 1 && window.activeScanPageIdx < window.scannedPages.length - 1) window.activeScanPageIdx++;
    
    document.getElementById('scan-preview-img').src = window.scannedPages[window.activeScanPageIdx];
    updateScanPagesUI();
}

async function processWithOpenAI() {
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
                text: "Vytáhni data z této vícestránkové faktury přesně do JSON s klíči: 'vendor' (Název dodavatele), 'ico' (IČO dodavatele), 'invoiceNumber' (Číslo faktury / dokladu), 'vs' (Variabilní symbol, pokud chybí použij číslo faktury), 'dateIssue' (Datum vystavení ve formátu YYYY-MM-DD), 'dateTax' (Datum zdanitelného plnění / DUZP YYYY-MM-DD), 'dateDue' (Datum splatnosti YYYY-MM-DD), 'baseAmount' (Základ daně bez DPH jako číslo s tečkou bez Kč), 'vatRate' (Sazba DPH: číslo 21, 12 nebo 0), 'vatAmount' (Výše DPH v Kč jako číslo s tečkou), 'amount' (Celková částka k úhradě s DPH jako číslo s tečkou), 'paymentMethod' (Způsob úhrady: 'Převodem', 'Kartou', 'Hotově', 'Zápočtem' nebo 'Dobírka'), 'account' (Číslo bankovního účtu / IBAN)."
            }
        ];

        window.scannedPages.forEach(pageB64 => {
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

// Uložení s nahráním do Firebase Storage
async function saveExtractedInvoice(e) {
    e.preventDefault();

    if (!window.scannedPages || window.scannedPages.length === 0) {
        showToast("Není naskenována žádná faktura.", "warning");
        return;
    }

    const user = auth.currentUser || currentUser;
    const chosenClient = (currentRole === 'client') ? activeClientCompany : (document.getElementById('detail-client-select')?.value || activeClientCompany || 'Moje Firma');

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
            accountantId: (currentRole === 'accountant' && user) ? user.uid : (currentUserData?.accountantId || 'demo'),
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
        console.error("Chyba při zápisu do cloudu:", err);
        alert("CHYBA UKLÁDÁNÍ DO FIREBASE:\n" + err.message + "\n\nZkontrolujte, zda máte povolený Firebase Storage!");
    } finally {
        if (scanLoading) scanLoading.classList.add('hidden');
        if (loadingText) loadingText.textContent = "AI analyzuje strukturu dokladu..."; 
    }
}

// ================= ZOBRAZENÍ DETAILU =================
function updateDetailImgTransform() {
    const img = document.getElementById('detail-img-preview');
    if (img) {
        img.style.transform = `scale(${detailZoom}) rotate(${detailRotation}deg)`;
    }
    const lvl = document.getElementById('detail-zoom-lvl');
    if (lvl) lvl.textContent = `${Math.round(detailZoom * 100)}%`;
}

function zoomDetailImg(delta) {
    detailZoom = Math.max(0.5, Math.min(3.5, Math.round((detailZoom + delta) * 10) / 10));
    updateDetailImgTransform();
}

function rotateDetailImg() {
    detailRotation = (detailRotation + 90) % 360;
    updateDetailImgTransform();
}

function resetDetailImg() {
    detailZoom = 1;
    detailRotation = 0;
    updateDetailImgTransform();
}

function switchDetailPage(dir) {
    if (dir === -1 && window.activeDetailPageIdx > 0) window.activeDetailPageIdx--;
    if (dir === 1 && window.activeDetailPageIdx < window.currentInvoicePages.length - 1) window.activeDetailPageIdx++;
    
    document.getElementById('detail-img-preview').src = window.currentInvoicePages[window.activeDetailPageIdx] || '';
    updateDetailPagesUI();
    resetDetailImg();
}

function updateDetailPagesUI() {
    let controls = document.getElementById('detail-pages-controls');
    const container = document.getElementById('detail-img-preview').parentElement;

    if (window.currentInvoicePages && window.currentInvoicePages.length > 1) {
        if (!controls) {
            controls = document.createElement('div');
            controls.id = 'detail-pages-controls';
            controls.className = 'absolute bottom-3 left-1/2 transform -translate-x-1/2 bg-slate-900/90 backdrop-blur border border-slate-700 text-white rounded-full flex items-center gap-3 px-4 py-1.5 shadow-lg z-10';
            container.appendChild(controls);
        }
        controls.innerHTML = `
            <button type="button" onclick="switchDetailPage(-1)" class="p-1 hover:text-blue-400 disabled:opacity-30 disabled:cursor-not-allowed" ${window.activeDetailPageIdx === 0 ? 'disabled' : ''}>
                <i data-lucide="chevron-left" class="w-5 h-5"></i>
            </button>
            <span class="text-xs font-bold w-16 text-center">Str ${window.activeDetailPageIdx + 1} / ${window.currentInvoicePages.length}</span>
            <button type="button" onclick="switchDetailPage(1)" class="p-1 hover:text-blue-400 disabled:opacity-30 disabled:cursor-not-allowed" ${window.activeDetailPageIdx === window.currentInvoicePages.length - 1 ? 'disabled' : ''}>
                <i data-lucide="chevron-right" class="w-5 h-5"></i>
            </button>
        `;
        if (window.lucide) window.lucide.createIcons();
    } else if (controls) {
        controls.remove();
    }
}

function openDetailImgFull() {
    const imgUrl = window.currentInvoicePages[window.activeDetailPageIdx] || document.getElementById('detail-img-preview').src;
    if (imgUrl && !imgUrl.includes('placehold.co')) {
        const w = window.open("");
        w.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Originální náhled dokladu</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
                <style>
                    body { margin: 0; padding: 0; background: #0b0f19; display: flex; flex-direction: column; align-items: center; min-height: 100vh; font-family: sans-serif; }
                    .header { position: sticky; top: 0; width: 100%; background: rgba(15, 23, 42, 0.95); padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; box-sizing: border-box; z-index: 50; border-bottom: 1px solid #1e293b; backdrop-filter: blur(8px); }
                    .close-btn { background: #ef4444; color: white; border: none; border-radius: 8px; padding: 8px 16px; font-weight: bold; font-size: 14px; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
                    .img-container { padding: 16px; width: 100%; display: flex; justify-content: center; box-sizing: border-box; overflow: auto; }
                    img { max-width: 100%; height: auto; border-radius: 6px; box-shadow: 0 10px 40px rgba(0,0,0,0.8); cursor: zoom-in; }
                </style>
            </head>
            <body>
                <div class="header">
                    <span style="color: #94a3b8; font-size: 12px; font-weight: 600;">Detail dokladu</span>
                    <button class="close-btn" onclick="window.close()">✕ Zavřít okno</button>
                </div>
                <div class="img-container">
                    <img src="${imgUrl}" onclick="this.style.maxWidth = this.style.maxWidth === 'none' ? '100%' : 'none'; this.style.cursor = this.style.maxWidth === 'none' ? 'zoom-out' : 'zoom-in';">
                </div>
            </body>
            </html>
        `);
    }
}

function openDetailModal(id) {
    selectedInvoiceId = id;
    window.selectedInvoiceId = id;
    const inv = invoices.find(i => i.id === id);
    if (!inv) return;

    document.getElementById('detail-modal-title').textContent = `Detail a editace dokladu`;
    document.getElementById('detail-doc-id').textContent = `ID: ${inv.id}`;
    document.getElementById('detail-created-at').textContent = inv.createdAt ? `Nahráno: ${formatDateTime(inv.createdAt)}` : '';

    window.currentInvoicePages = inv.imgUrls && inv.imgUrls.length > 0 ? inv.imgUrls : [inv.imgUrl || 'https://placehold.co/600x800/f1f5f9/334155?text=Bez+nahledu'];
    window.activeDetailPageIdx = 0;

    document.getElementById('detail-img-preview').src = window.currentInvoicePages[0];
    updateDetailPagesUI();
    resetDetailImg();

    const clientSelect = document.getElementById('detail-client-select');
    if (clientSelect) {
        clientSelect.innerHTML = '';
        const allClients = getAllClientNames();
        allClients.forEach(name => clientSelect.add(new Option(name, name)));
        clientSelect.value = inv.clientName || allClients[0] || '';
    }

    document.getElementById('detail-vendor').value = inv.vendor || '';
    document.getElementById('detail-ico').value = inv.ico || '';
    document.getElementById('detail-invoice-num').value = inv.invoiceNumber || inv.vs || '';
    document.getElementById('detail-vs').value = inv.vs || inv.invoiceNumber || '';
    document.getElementById('detail-type').value = inv.type || 'Přijatá faktura';
    document.getElementById('detail-payment-method').value = inv.paymentMethod || 'Převodem';
    document.getElementById('detail-due-issue').value = inv.dateIssue || '';
    document.getElementById('detail-date-tax').value = inv.dateTax || inv.dateIssue || '';
    document.getElementById('detail-due').value = inv.dateDue || '';
    document.getElementById('detail-base-amount').value = inv.baseAmount !== undefined ? inv.baseAmount : '';
    document.getElementById('detail-vat').value = inv.vatRate || '21';
    document.getElementById('detail-vat-amount').value = inv.vatAmount !== undefined ? inv.vatAmount : '';
    document.getElementById('detail-amount').value = inv.amount || '';
    document.getElementById('detail-account').value = inv.accountNumber || '';
    document.getElementById('detail-comment-note').value = inv.note || '';

    const badge = document.getElementById('detail-status-badge');
    const btnPending = document.getElementById('btn-status-pending');
    const btnAction = document.getElementById('btn-status-action_needed');
    const btnApproved = document.getElementById('btn-status-approved');

    [btnPending, btnAction, btnApproved].forEach(b => {
        if (b) b.classList.remove('ring-2', 'ring-offset-1', 'ring-slate-900', 'font-bold');
    });

    if (inv.status === 'pending') {
        badge.className = "px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800";
        badge.textContent = "Rozpracováno";
        if (btnPending) btnPending.classList.add('ring-2', 'ring-offset-1', 'ring-amber-500', 'font-bold');
    } else if (inv.status === 'approved') {
        badge.className = "px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800";
        badge.textContent = "Zaúčtováno";
        if (btnApproved) btnApproved.classList.add('ring-2', 'ring-offset-1', 'ring-emerald-700', 'font-bold');
    } else {
        badge.className = "px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800";
        badge.textContent = "K doplnění";
        if (btnAction) btnAction.classList.add('ring-2', 'ring-offset-1', 'ring-rose-500', 'font-bold');
    }

    const accButtons = document.getElementById('detail-acc-buttons');
    const clientButtons = document.getElementById('detail-client-buttons');
    const noteLabel = document.getElementById('detail-note-label');
    const clientAssignmentBox = document.getElementById('detail-client-assignment-box');
    const isdocBtn = document.getElementById('btn-download-single-isdoc');
    
    if (currentRole === 'client') {
        if (accButtons) accButtons.classList.add('hidden');
        if (clientButtons) clientButtons.classList.remove('hidden');
        if (noteLabel) noteLabel.textContent = 'Poznámka / zpráva pro účetní';
        if (clientAssignmentBox) clientAssignmentBox.classList.add('hidden');
        if (isdocBtn) isdocBtn.classList.add('hidden');
    } else {
        if (accButtons) accButtons.classList.remove('hidden');
        if (clientButtons) clientButtons.classList.add('hidden');
        if (noteLabel) noteLabel.textContent = 'Poznámka pro klienta';
        if (clientAssignmentBox) clientAssignmentBox.classList.remove('hidden');
        if (isdocBtn) isdocBtn.classList.remove('hidden');
    }

    openModal('detail-modal');
}

async function saveDetailChanges(e) {
    if (e) e.preventDefault();
    if (!selectedInvoiceId) return;

    const updated = {
        clientName: (currentRole === 'client') ? activeClientCompany : (document.getElementById('detail-client-select')?.value || activeClientCompany),
        vendor: document.getElementById('detail-vendor').value.trim() || 'Neznámý dodavatel',
        ico: document.getElementById('detail-ico').value.trim(),
        invoiceNumber: document.getElementById('detail-invoice-num').value.trim(),
        vs: document.getElementById('detail-vs').value.trim(),
        type: document.getElementById('detail-type').value,
        paymentMethod: document.getElementById('detail-payment-method').value,
        dateIssue: document.getElementById('detail-due-issue').value,
        dateTax: document.getElementById('detail-date-tax').value,
        dateDue: document.getElementById('detail-due').value,
        baseAmount: parseFloat(document.getElementById('detail-base-amount').value) || 0,
        vatRate: document.getElementById('detail-vat').value,
        vatAmount: parseFloat(document.getElementById('detail-vat-amount').value) || 0,
        amount: parseFloat(document.getElementById('detail-amount').value) || 0,
        accountNumber: document.getElementById('detail-account').value.trim(),
        note: document.getElementById('detail-comment-note').value.trim()
    };

    try {
        const docRef = doc(db, "invoices", selectedInvoiceId);
        await updateDoc(docRef, updated);
        showToast("Údaje dokladu byly úspěšně uloženy!", "success");
    } catch (err) {
        console.error("Chyba při ukládání změn dokladu:", err);
        showToast("Chyba při ukládání změn: " + err.message, "warning");
    }
}

async function clientSubmitInvoice() {
    if (!selectedInvoiceId) return;
    const noteText = document.getElementById('detail-comment-note').value;
    try {
        const docRef = doc(db, "invoices", selectedInvoiceId);
        await updateDoc(docRef, { status: 'pending', note: noteText });
        closeModal('detail-modal');
        showToast("Doklad byl odeslán účetní ke kontrole!", "success");
    } catch (err) {
        console.error("Chyba při odesílání účetní:", err);
        showToast("Chyba při odesílání: " + err.message, "warning");
    }
}

function deleteCurrentInvoice() {
    if (selectedInvoiceId) deleteInvoice(selectedInvoiceId);
}

async function updateInvoiceStatus(newStatus) {
    if (!selectedInvoiceId) return;
    const updated = {
        clientName: (currentRole === 'client') ? activeClientCompany : (document.getElementById('detail-client-select')?.value || 'TechVision s.r.o.'),
        vendor: document.getElementById('detail-vendor')?.value?.trim() || 'Neznámý dodavatel',
        ico: document.getElementById('detail-ico')?.value?.trim() || '',
        invoiceNumber: document.getElementById('detail-invoice-num')?.value?.trim() || '',
        vs: document.getElementById('detail-vs')?.value?.trim() || '',
        type: document.getElementById('detail-type')?.value || 'Přijatá faktura',
        paymentMethod: document.getElementById('detail-payment-method')?.value || 'Převodem',
        dateIssue: document.getElementById('detail-due-issue')?.value || '',
        dateTax: document.getElementById('detail-date-tax')?.value || '',
        dateDue: document.getElementById('detail-due')?.value || '',
        baseAmount: parseFloat(document.getElementById('detail-base-amount')?.value) || 0,
        vatRate: document.getElementById('detail-vat')?.value || '21',
        vatAmount: parseFloat(document.getElementById('detail-vat-amount')?.value) || 0,
        amount: parseFloat(document.getElementById('detail-amount')?.value) || 0,
        accountNumber: document.getElementById('detail-account')?.value?.trim() || '',
        status: newStatus,
        note: document.getElementById('detail-comment-note')?.value?.trim() || ''
    };

    try {
        const docRef = doc(db, "invoices", selectedInvoiceId);
        await updateDoc(docRef, updated);
        closeModal('detail-modal');
        let statusText = newStatus === 'approved' ? "Zaúčtováno" : newStatus === 'pending' ? "Rozpracováno" : "Vráceno k doplnění";
        showToast(`Stav dokladu: ${statusText}`, newStatus === 'approved' ? "success" : "info");
    } catch (err) {
        console.error("Chyba při aktualizaci stavu:", err);
        showToast("Chyba při ukládání stavu: " + err.message, "warning");
    }
}

function escapeXml(unsafe) {
    if (unsafe === undefined || unsafe === null) return '';
    return String(unsafe).replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;'; case '>': return '&gt;'; case '&': return '&amp;';
            case "'": return '&apos;'; case '"': return '&quot;';
        }
    });
}

function generateISDOCXml(inv) {
    const docId = inv.invoiceNumber || inv.vs || inv.id || 'INV-001';
    const issueDate = inv.dateIssue || new Date().toISOString().split('T')[0];
    const taxDate = inv.dateTax || issueDate;
    const dueDate = inv.dateDue || issueDate;
    const amount = Number(inv.amount || 0).toFixed(2);
    const baseAmount = Number(inv.baseAmount || 0).toFixed(2);
    const vatAmount = Number(inv.vatAmount || 0).toFixed(2);
    const vatRate = Number(inv.vatRate || 21).toFixed(2);
    const vendorName = inv.vendor || 'Dodavatel';
    const clientName = inv.clientName || 'Klient';
    const ico = inv.ico || '00000000';
    const vs = inv.vs || docId.replace(/\D/g, '') || '0';
    const bankAccount = inv.accountNumber || '';
    const paymentMethod = inv.paymentMethod || 'Převodem';

    let paymentCode = paymentMethod === 'Hotově' ? '10' : paymentMethod === 'Kartou' ? '48' : paymentMethod === 'Zápočtem' ? '97' : '31';

    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.1">
  <DocumentType>1</DocumentType>
  <ID>${escapeXml(docId)}</ID>
  <UUID>${escapeXml(inv.id || '00000000-0000-0000-0000-000000000000')}</UUID>
  <IssuingSystem>InvoiceAI Flow</IssuingSystem>
  <IssueDate>${escapeXml(issueDate)}</IssueDate>
  <TaxPointDate>${escapeXml(taxDate)}</TaxPointDate>
  <VATApplicable>true</VATApplicable>
  <Note>${escapeXml(inv.note || '')}</Note>
  <LocalCurrencyCode>CZK</LocalCurrencyCode>
  <CurrRate>1</CurrRate>
  <RefCurrRate>1</RefCurrRate>
  <AccountingSupplierParty><Party><PartyIdentification><ID>${escapeXml(ico)}</ID></PartyIdentification><PartyName><Name>${escapeXml(vendorName)}</Name></PartyName></Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party><PartyName><Name>${escapeXml(clientName)}</Name></PartyName></Party></AccountingCustomerParty>
  <PaymentMeans><Payment><PaidAmount>${amount}</PaidAmount><PaymentMeansCode>${paymentCode}</PaymentMeansCode><Details><PaymentDueDate>${escapeXml(dueDate)}</PaymentDueDate><ID>${escapeXml(bankAccount)}</ID><VariableSymbol>${escapeXml(vs)}</VariableSymbol></Details></Payment></PaymentMeans>
  <TaxTotal><TaxSubTotal><TaxableAmount>${baseAmount}</TaxableAmount><TaxAmount>${vatAmount}</TaxAmount><TaxCategory><Percent>${vatRate}</Percent><VATCalculationMethod>0</VATCalculationMethod></TaxCategory></TaxSubTotal><TaxAmount>${vatAmount}</TaxAmount></TaxTotal>
  <LegalMonetaryTotal><TaxExclusiveAmount>${baseAmount}</TaxExclusiveAmount><TaxInclusiveAmount>${amount}</TaxInclusiveAmount><AlreadyClaimedDateTaxExclusiveAmount>0.00</AlreadyClaimedDateTaxExclusiveAmount><AlreadyClaimedTaxInclusiveAmount>0.00</AlreadyClaimedTaxInclusiveAmount><DifferenceTaxExclusiveAmount>${baseAmount}</DifferenceTaxExclusiveAmount><DifferenceTaxInclusiveAmount>${amount}</DifferenceTaxInclusiveAmount><PayableRoundingAmount>0.00</PayableRoundingAmount><PaidDepositsAmount>0.00</PaidDepositsAmount><PayableAmount>${amount}</PayableAmount></LegalMonetaryTotal>
  <InvoiceLines><InvoiceLine><ID>1</ID><InvoicedQuantity unitCode="C62">1</InvoicedQuantity><LineExtensionAmount>${baseAmount}</LineExtensionAmount><LineExtensionAmountTaxInclusive>${amount}</LineExtensionAmountTaxInclusive><LineExtensionTaxAmount>${vatAmount}</LineExtensionTaxAmount><UnitPrice>${baseAmount}</UnitPrice><UnitPriceTaxInclusive>${amount}</UnitPriceTaxInclusive><ClassifiedTaxCategory><Percent>${vatRate}</Percent><VATCalculationMethod>0</VATCalculationMethod></ClassifiedTaxCategory><Item><Description>${escapeXml(vendorName + ' - ' + (inv.type || 'Faktura'))}</Description></Item></InvoiceLine></InvoiceLines>
</Invoice>`;
}

function triggerDownload(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

window.downloadSingleISDOC = function(id) {
    const targetId = id || selectedInvoiceId;
    let inv = invoices.find(i => i.id === targetId);
    if (!inv) return showToast("Faktura nenalezena nebo není vybrána.", "warning");

    const xml = generateISDOCXml(inv);
    const filename = `ISDOC_${inv.clientName ? inv.clientName.replace(/[^a-zA-Z0-9]/g, '_') : 'firma'}_${inv.invoiceNumber || inv.vs || inv.id}.isdoc`;
    triggerDownload(xml, filename, 'application/xml;charset=utf-8');
    showToast(`ISDOC soubor "${filename}" byl úspěšně stažen!`, "success");
};

window.exportInvoices = function(format) {
    const clientFilter = document.getElementById('acc-client-select')?.value || 'all';
    const user = auth.currentUser || currentUser;
    let list = window.isDemoMode ? invoices.filter(i => i.status === 'approved') : invoices.filter(i => i.status === 'approved' && (i.accountantId === user.uid || i.userId === user.uid));
    
    if (clientFilter !== 'all') list = list.filter(i => i.clientName === clientFilter);
    if (list.length === 0) return showToast("Žádné zaúčtované faktury k exportu.", "warning");

    if (format === 'isdoc') {
        list.forEach((inv, idx) => {
            setTimeout(() => {
                triggerDownload(generateISDOCXml(inv), `ISDOC_${inv.clientName ? inv.clientName.replace(/[^a-zA-Z0-9]/g, '_') : 'firma'}_${inv.invoiceNumber || inv.vs || inv.id}.isdoc`, 'application/xml;charset=utf-8');
            }, idx * 250);
        });
        showToast(`Vygenerováno a staženo ${list.length} ISDOC souborů!`, "success");
    }
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    const bgBg = type === 'success' ? 'bg-emerald-600 border-emerald-500' : type === 'warning' ? 'bg-amber-600 border-amber-500' : 'bg-slate-900 border-slate-700';
    const icon = type === 'success' ? 'check-circle' : type === 'warning' ? 'alert-triangle' : 'info';

    toast.className = `p-3.5 rounded-xl border shadow-xl flex items-center gap-2.5 text-xs font-medium transform transition duration-300 translate-y-2 opacity-0 text-white pointer-events-auto ${bgBg}`;
    toast.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4 shrink-0"></i><span>${message}</span>`;
    container.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();
    setTimeout(() => toast.classList.remove('translate-y-2', 'opacity-0'), 10);
    setTimeout(() => { toast.classList.add('opacity-0', 'translate-y-2'); setTimeout(() => toast.remove(), 300); }, 3500);
}

window.calculateScanAmounts = function() {
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
};

window.calculateDetailAmounts = function() {
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
};

function renderClientInvoices(filterStatus = null) {
    if (filterStatus !== null) currentClientFilter = filterStatus;
    const tbody = document.getElementById('client-invoice-table-body');
    const searchQuery = document.getElementById('client-search')?.value.toLowerCase() || '';
    const datePreset = document.getElementById('client-date-preset')?.value || 'all';
    const dateFrom = document.getElementById('client-date-from')?.value || '';
    const dateTo = document.getElementById('client-date-to')?.value || '';
    
    if (!tbody) return;
    tbody.innerHTML = '';

    const user = auth.currentUser || currentUser;
    let filtered = window.isDemoMode ? invoices.filter(inv => !inv.userId || inv.isDemo || inv.clientName === 'TechVision s.r.o.') 
                   : user && currentRole === 'client' ? invoices.filter(inv => (inv.userId === user.uid) || (inv.clientName === activeClientCompany && !inv.isDemo))
                   : user && currentRole === 'accountant' ? invoices.filter(inv => (inv.accountantId === user.uid || inv.userId === user.uid)) : [];

    if (currentClientFilter === 'pending') filtered = filtered.filter(inv => inv.status === 'pending');
    if (currentClientFilter === 'approved') filtered = filtered.filter(inv => inv.status === 'approved');
    if (currentClientFilter === 'action_needed') filtered = filtered.filter(inv => inv.status === 'action_needed' || inv.status === 'rejected');

    filtered = filtered.filter(inv => checkDateMatch(inv, datePreset, dateFrom, dateTo));
    if (searchQuery) filtered = filtered.filter(inv => (inv.vendor && inv.vendor.toLowerCase().includes(searchQuery)) || (inv.amount && inv.amount.toString().includes(searchQuery)) || (inv.vs && inv.vs.includes(searchQuery)) || (inv.invoiceNumber && inv.invoiceNumber.toLowerCase().includes(searchQuery)));

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400 text-xs">Zatím nemáte žádné nahrané doklady odpovídající výběru.</td></tr>`;
    } else {
        filtered.forEach(inv => {
            const statusBadge = inv.status === 'pending' ? `<span class="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">Čeká na schválení</span>`
                              : inv.status === 'approved' ? `<span class="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">Zaúčtováno</span>`
                              : `<span class="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">K doplnění</span>`;
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition";
            tr.innerHTML = `<td class="p-3 pl-4"><div class="font-bold text-slate-900 dark:text-white">${inv.vendor || '-'}</div><div class="text-xs text-slate-500 font-mono"><span>${inv.invoiceNumber ? 'Číslo: ' + inv.invoiceNumber : (inv.vs ? 'VS: ' + inv.vs : '')}</span></div></td><td class="p-3 text-xs text-slate-600 dark:text-slate-400"><div>Vystaveno: ${inv.dateIssue || '-'}</div><div class="text-slate-400 dark:text-slate-500">Splatnost: ${inv.dateDue || '-'}</div><div class="text-[11px] text-blue-600 dark:text-blue-400 font-medium mt-0.5">Nahráno: ${formatDateTime(inv.createdAt)}</div></td><td class="p-3 text-xs text-slate-600 dark:text-slate-300"><div class="font-medium">${inv.type || 'Přijatá faktura'}</div><span class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-300 font-semibold">${inv.paymentMethod || 'Převodem'}</span></td><td class="p-3 font-bold text-slate-900 dark:text-white">${Number(inv.amount || 0).toLocaleString('cs-CZ')} Kč</td><td class="p-3">${statusBadge}</td><td class="p-3 text-right pr-4"><div class="flex items-center justify-end gap-1"><button onclick="openDetailModal('${inv.id}')" title="Detail dokladu" class="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800 transition"><i data-lucide="eye" class="w-4 h-4"></i></button><button onclick="deleteInvoice('${inv.id}')" title="Smazat doklad" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div></td>`;
            tbody.appendChild(tr);
        });
    }
    if (window.lucide) window.lucide.createIcons();
    
    const totalSum = filtered.reduce((sum, i) => sum + Number(i.amount || 0), 0);
    document.getElementById('stat-client-total').textContent = `${totalSum.toLocaleString('cs-CZ')} Kč`;
    document.getElementById('stat-client-count').textContent = filtered.length;
    document.getElementById('stat-client-pending').textContent = filtered.filter(i => i.status === 'pending').length;
    document.getElementById('stat-client-approved').textContent = filtered.filter(i => i.status === 'approved').length;
    document.getElementById('stat-client-rejected').textContent = filtered.filter(i => i.status === 'action_needed' || i.status === 'rejected').length;
}

window.filterClientInvoices = function(status) {
    document.querySelectorAll('.client-filter-btn').forEach(btn => {
        btn.className = "client-filter-btn px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 whitespace-nowrap";
    });
    const activeBtn = document.getElementById(`filter-btn-${status}`);
    if (activeBtn) activeBtn.className = "client-filter-btn active px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white whitespace-nowrap";
    renderClientInvoices(status);
};

// Všechny exporty do window pro HTML
window.switchRole = switchRole;
window.triggerScan = triggerScan;
window.handleFileSelect = handleFileSelect;
window.switchScanPage = switchScanPage;
window.updateScanPagesUI = updateScanPagesUI;
window.processWithOpenAI = processWithOpenAI;
window.saveExtractedInvoice = saveExtractedInvoice;
window.openDetailModal = openDetailModal;
window.updateInvoiceStatus = updateInvoiceStatus;
window.deleteInvoice = deleteInvoice;
window.deleteCurrentInvoice = deleteCurrentInvoice;
window.saveDetailChanges = saveDetailChanges;
window.clientSubmitInvoice = clientSubmitInvoice;
window.renameClient = renameClient;
window.deleteClient = deleteClient;
window.addNewClientFromInput = addNewClientFromInput;
window.addNewClientPrompt = addNewClientPrompt;
window.renderClientsModalTable = renderClientsModalTable;
window.openClientDetailModal = openClientDetailModal;
window.saveClientDetailChanges = saveClientDetailChanges;
window.copyModalPin = copyModalPin;
window.copyPairingCode = copyPairingCode;
window.toggleProfileDropdown = toggleProfileDropdown;
window.openAccountSettingsModal = openAccountSettingsModal;
window.saveAccountSettings = saveAccountSettings;
window.openChangePasswordModal = openChangePasswordModal;
window.handleChangePassword = handleChangePassword;
window.sendResetPasswordLink = sendResetPasswordLink;
window.handleForgotPassword = handleForgotPassword;
window.toggleTheme = toggleTheme;
window.handleAuthSubmit = handleAuthSubmit;
window.handleLogout = handleLogout;
window.setAuthMode = setAuthMode;
window.updateRoleTypeUI = updateRoleTypeUI;
window.continueAsDemo = continueAsDemo;
window.openModal = openModal;
window.closeModal = closeModal;
window.showToast = showToast;
window.zoomDetailImg = zoomDetailImg;
window.resetDetailImg = resetDetailImg;
window.rotateDetailImg = rotateDetailImg;
window.openDetailImgFull = openDetailImgFull;
window.switchDetailPage = switchDetailPage;
window.renderClientInvoices = renderClientInvoices;
window.renderAccountantInvoices = renderAccountantInvoices;

window.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) window.lucide.createIcons();
    renderClientInvoices();
    renderAccountantInvoices();
});
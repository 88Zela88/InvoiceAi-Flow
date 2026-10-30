// FINÁLNÍ app.js - Hlavní centrála aplikace (propojení všech modulů)
import { db, auth, storage } from './firebase.js';
import { collection, onSnapshot, doc, updateDoc, deleteDoc, query, orderBy, addDoc } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { currentUser, currentRole, activeClientCompany, activeAccountantCompany, authMode, setAuthMode, updateRoleTypeUI, handleAuthSubmit, handleForgotPassword, handleLogout, openAccountSettingsModal, saveAccountSettings, openChangePasswordModal, handleChangePassword, sendResetPasswordLink } from './auth.js';
import { showToast, closeModal, openModal, formatDateTime } from './ui.js';
import { triggerScan, handleFileSelect, switchScanPage, updateScanPagesUI, processWithOpenAI, saveExtractedInvoice } from './scanner.js';
import { generateISDOCXml, triggerDownload } from './isdoc.js';

let invoices = [];
let currentClientFilter = 'all';
let customClients = [];
let detailZoom = 1;
let detailRotation = 0;
let selectedInvoiceId = null;
let selectedClientIdForModal = null;

// ================= EXPORT FUNKCÍ PRO HTML (TLAČÍTKA A FORMULÁŘE) =================
window.setAuthMode = setAuthMode;
window.updateRoleTypeUI = updateRoleTypeUI;
window.handleAuthSubmit = handleAuthSubmit;
window.handleForgotPassword = handleForgotPassword;
window.handleLogout = handleLogout;
window.openAccountSettingsModal = openAccountSettingsModal;
window.saveAccountSettings = saveAccountSettings;
window.openChangePasswordModal = openChangePasswordModal;
window.handleChangePassword = handleChangePassword;
window.sendResetPasswordLink = sendResetPasswordLink;
window.triggerScan = triggerScan;
window.handleFileSelect = handleFileSelect;
window.switchScanPage = switchScanPage;
window.updateScanPagesUI = updateScanPagesUI;
window.processWithOpenAI = processWithOpenAI;
window.saveExtractedInvoice = saveExtractedInvoice;
window.openModal = openModal;
window.closeModal = closeModal;
window.showToast = showToast;
window.formatDateTime = formatDateTime;

// ================= FIREBASE SYNCHRONIZACE =================
const invoicesQuery = query(collection(db, "invoices"), orderBy("createdAt", "desc"));
onSnapshot(invoicesQuery, (snapshot) => {
    invoices = [];
    snapshot.forEach((docSnap) => invoices.push({ id: docSnap.id, ...docSnap.data() }));
    updateDynamicClients();
    renderClientInvoices();
    renderAccountantInvoices();
}, (error) => showToast("Chyba synchronizace databáze: " + error.message, "warning"));

const clientsQuery = query(collection(db, "clients"), orderBy("name", "asc"));
onSnapshot(clientsQuery, (snapshot) => {
    customClients = [];
    snapshot.forEach((docSnap) => customClients.push({ id: docSnap.id, ...docSnap.data() }));
    updateDynamicClients();
    if(document.getElementById('clients-modal') && !document.getElementById('clients-modal').classList.contains('hidden')) {
        renderClientsModalTable();
    }
}, (err) => console.warn(err));


// ================= LISTOVÁNÍ A FILTRACE (KLIENT & ÚČETNÍ) =================
function checkDateMatch(inv, preset, fromDate, toDate) {
    if (!preset || preset === 'all') return true;
    let d = inv.createdAt ? new Date(inv.createdAt) : (inv.dateIssue ? new Date(inv.dateIssue) : null);
    if (!d || isNaN(d.getTime())) return true;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (preset === 'today') return dDate.getTime() === startOfToday.getTime();
    if (preset === 'week') return dDate >= new Date(startOfToday.getTime() - (7 * 86400000)) && dDate <= now;
    if (preset === 'this_month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (preset === 'last_month') {
        const lm = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
        const ly = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
        return d.getFullYear() === ly && d.getMonth() === lm;
    }
    if (preset === 'custom') {
        if (fromDate && d < new Date(fromDate)) return false;
        if (toDate && d > new Date(new Date(toDate).setHours(23,59,59,999))) return false;
        return true;
    }
    return true;
}

window.handleClientDatePresetChange = function() {
    const val = document.getElementById('client-date-preset')?.value;
    const customBox = document.getElementById('client-custom-dates');
    if (customBox) val === 'custom' ? customBox.classList.remove('hidden') : customBox.classList.add('hidden');
    renderClientInvoices();
};

window.handleAccDatePresetChange = function() {
    const val = document.getElementById('acc-date-preset')?.value;
    const customBox = document.getElementById('acc-custom-dates');
    if (customBox) val === 'custom' ? customBox.classList.remove('hidden') : customBox.classList.add('hidden');
    renderAccountantInvoices();
};

window.switchRole = function(role) {
    const cView = document.getElementById('client-view');
    const aView = document.getElementById('accountant-view');
    if (role === 'client') {
        if(cView) cView.classList.remove('hidden');
        if(aView) aView.classList.add('hidden');
        renderClientInvoices();
    } else {
        if(cView) cView.classList.add('hidden');
        if(aView) aView.classList.remove('hidden');
        renderAccountantInvoices();
    }
};

window.renderClientInvoices = function(filterStatus = null) {
    if (filterStatus !== null) currentClientFilter = filterStatus;
    const tbody = document.getElementById('client-invoice-table-body');
    const searchQuery = document.getElementById('client-search')?.value.toLowerCase() || '';
    const datePreset = document.getElementById('client-date-preset')?.value || 'all';
    
    if (!tbody) return;
    tbody.innerHTML = '';

    const user = auth.currentUser || currentUser;
    let filtered = window.isDemoMode ? invoices.filter(inv => !inv.userId || inv.isDemo || inv.clientName === 'TechVision s.r.o.') 
                   : user && currentRole === 'client' ? invoices.filter(inv => (inv.userId === user.uid) || (inv.clientName === activeClientCompany && !inv.isDemo))
                   : user && currentRole === 'accountant' ? invoices.filter(inv => (inv.accountantId === user.uid || inv.userId === user.uid)) : [];

    if (currentClientFilter !== 'all') {
        filtered = filtered.filter(inv => currentClientFilter === 'action_needed' ? (inv.status === 'action_needed' || inv.status === 'rejected') : inv.status === currentClientFilter);
    }
    filtered = filtered.filter(inv => checkDateMatch(inv, datePreset, document.getElementById('client-date-from')?.value, document.getElementById('client-date-to')?.value));
    if (searchQuery) filtered = filtered.filter(inv => (inv.vendor && inv.vendor.toLowerCase().includes(searchQuery)) || (inv.amount && inv.amount.toString().includes(searchQuery)) || (inv.vs && inv.vs.includes(searchQuery)) || (inv.invoiceNumber && inv.invoiceNumber.toLowerCase().includes(searchQuery)));

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400 text-xs">Zatím nemáte žádné nahrané doklady odpovídající výběru.</td></tr>`;
    } else {
        filtered.forEach(inv => {
            const statusBadge = inv.status === 'pending' ? `<span class="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20">Čeká na schválení</span>`
                              : inv.status === 'approved' ? `<span class="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Zaúčtováno</span>`
                              : `<span class="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-500/10 text-rose-500 border border-rose-500/20">K doplnění</span>`;
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-800/50 transition";
            tr.innerHTML = `<td class="p-3 pl-4"><div class="font-bold text-white">${inv.vendor || '-'}</div><div class="text-xs text-slate-400 font-mono"><span>${inv.invoiceNumber ? 'Číslo: ' + inv.invoiceNumber : (inv.vs ? 'VS: ' + inv.vs : '')}</span></div></td><td class="p-3 text-xs text-slate-400"><div>Vystaveno: ${inv.dateIssue || '-'}</div><div class="text-slate-500">Splatnost: ${inv.dateDue || '-'}</div><div class="text-[11px] text-emerald-500 font-medium mt-0.5">Nahráno: ${formatDateTime(inv.createdAt)}</div></td><td class="p-3 text-xs text-slate-300"><div class="font-medium">${inv.type || 'Přijatá faktura'}</div><span class="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 font-semibold">${inv.paymentMethod || 'Převodem'}</span></td><td class="p-3 font-bold text-white">${Number(inv.amount || 0).toLocaleString('cs-CZ')} Kč</td><td class="p-3">${statusBadge}</td><td class="p-3 text-right pr-4"><div class="flex items-center justify-end gap-1"><button onclick="openDetailModal('${inv.id}')" title="Detail dokladu" class="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition"><i data-lucide="eye" class="w-4 h-4"></i></button><button onclick="deleteInvoice('${inv.id}')" title="Smazat doklad" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div></td>`;
            tbody.appendChild(tr);
        });
    }
    if (window.lucide) window.lucide.createIcons();
    
    const totalSum = filtered.reduce((sum, i) => sum + Number(i.amount || 0), 0);
    const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setTxt('stat-client-total', `${totalSum.toLocaleString('cs-CZ')} Kč`);
    setTxt('stat-client-count', filtered.length);
    setTxt('stat-client-pending', filtered.filter(i => i.status === 'pending').length);
    setTxt('stat-client-approved', filtered.filter(i => i.status === 'approved').length);
    setTxt('stat-client-rejected', filtered.filter(i => i.status === 'action_needed' || i.status === 'rejected').length);
}

window.filterClientInvoices = function(status) {
    document.querySelectorAll('.client-filter-btn').forEach(btn => {
        btn.classList.remove('active', 'bg-emerald-600', 'text-white');
        btn.classList.add('bg-slate-200', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300', 'hover:bg-slate-300');
    });
    const activeBtn = document.getElementById(`filter-btn-${status}`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-slate-200', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300', 'hover:bg-slate-300');
        activeBtn.classList.add('active', 'bg-emerald-600', 'text-white');
    }
    window.renderClientInvoices(status);
};

window.renderAccountantInvoices = function() {
    const tbody = document.getElementById('accountant-invoice-table-body');
    const clientFilter = document.getElementById('acc-client-select')?.value || 'all';
    const statusFilter = document.getElementById('acc-status-select')?.value || 'all';
    const datePreset = document.getElementById('acc-date-preset')?.value || 'all';
    const dateFrom = document.getElementById('acc-date-from')?.value || '';
    const dateTo = document.getElementById('acc-date-to')?.value || '';
    if (!tbody) return;
    tbody.innerHTML = '';

    const user = auth.currentUser || currentUser;
    let filtered = window.isDemoMode ? [...invoices] : user && currentRole === 'accountant' ? invoices.filter(inv => inv.accountantId === user.uid || inv.userId === user.uid) : [];

    if (clientFilter !== 'all') filtered = filtered.filter(i => i.clientName === clientFilter);
    if (statusFilter !== 'all') filtered = filtered.filter(i => statusFilter === 'action_needed' ? (i.status === 'action_needed' || i.status === 'rejected') : i.status === statusFilter);
    filtered = filtered.filter(inv => checkDateMatch(inv, datePreset, dateFrom, dateTo));

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400 text-xs">Žádné doklady neodpovídají vybraným filtrům.</td></tr>`;
    } else {
        filtered.forEach(inv => {
            const statusBadge = inv.status === 'pending' ? `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20">Nová k vyřízení</span>`
                              : inv.status === 'approved' ? `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Zaúčtováno</span>`
                              : `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-500 border border-rose-500/20">Vraceno k doplnění</span>`;
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-800/50 transition";
            tr.innerHTML = `<td class="p-3 pl-4"><div class="font-bold text-white text-xs">${inv.clientName || 'Klient'}</div><span class="text-[10px] text-slate-400">ID: ${inv.id}</span></td><td class="p-3"><div class="font-semibold text-slate-200 text-xs">${inv.vendor || '-'}</div><div class="text-[11px] text-slate-400">IČO: ${inv.ico || '-'}</div></td><td class="p-3 text-xs"><div class="text-slate-200 font-semibold">${inv.invoiceNumber ? 'Fa: ' + inv.invoiceNumber : (inv.vs ? 'VS: ' + inv.vs : '-')}</div><div class="text-slate-400 text-[11px]">DUZP: ${inv.dateTax || inv.dateIssue || '-'}</div><div class="text-slate-500 text-[11px]">Splatnost: ${inv.dateDue || '-'}</div><div class="text-[11px] text-emerald-500 font-medium mt-0.5">Nahráno: ${formatDateTime(inv.createdAt)}</div></td><td class="p-3"><div class="font-bold text-white text-xs">${Number(inv.amount || 0).toLocaleString('cs-CZ')} Kč</div><div class="text-[10px] text-slate-400">Základ: ${inv.baseAmount ? Number(inv.baseAmount).toLocaleString('cs-CZ') + ' Kč' : '-'}</div><div class="text-[10px] text-slate-500">DPH (${inv.vatRate || 21}%): ${inv.vatAmount ? Number(inv.vatAmount).toLocaleString('cs-CZ') + ' Kč' : '-'}</div></td><td class="p-3">${statusBadge}</td><td class="p-3 text-right pr-4 whitespace-nowrap"><div class="flex items-center justify-end gap-1.5"><button onclick="openDetailModal('${inv.id}')" class="px-3 py-1.5 bg-slate-800 text-emerald-400 hover:bg-slate-700 font-semibold rounded-lg text-xs transition flex items-center gap-1"><i data-lucide="file-text" class="w-3.5 h-3.5"></i> Detail</button><button onclick="deleteInvoice('${inv.id}')" title="Smazat doklad" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div></td>`;
            tbody.appendChild(tr);
        });
    }
    if (window.lucide) window.lucide.createIcons();
    
    const totalVolume = filtered.reduce((sum, i) => sum + Number(i.amount || 0), 0);
    const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setTxt('acc-stat-pending', filtered.filter(i => i.status === 'pending').length);
    setTxt('acc-stat-approved', filtered.filter(i => i.status === 'approved').length);
    setTxt('acc-stat-volume', `${totalVolume.toLocaleString('cs-CZ')} Kč`);
    setTxt('acc-stat-total-count', `Celkem ${filtered.length} dokladů`);
}

function updateDynamicClients() {
    const set = new Set();
    if(window.isDemoMode) { 
        set.add('Demo firma s.r.o.'); 
    } else {
        invoices.forEach(i => { if(i.clientName) set.add(i.clientName) });
        customClients.forEach(c => { if(c.name) set.add(c.name) });
    }
    const arr = Array.from(set).sort();
    
    const clientSelect = document.getElementById('detail-client-select');
    if(clientSelect) {
        clientSelect.innerHTML = '';
        arr.forEach(n => clientSelect.add(new Option(n, n)));
    }
    const accSelect = document.getElementById('acc-client-select');
    if (accSelect) {
        const val = accSelect.value;
        accSelect.innerHTML = '<option value="all">Všichni klienti</option>';
        arr.forEach(n => accSelect.add(new Option(n, n)));
        if (arr.includes(val)) accSelect.value = val;
    }
}


// ================= OTEVÍRÁNÍ A PRÁCE S DETAILEM DOKLADU =================
window.openDetailModal = function(id) {
    selectedInvoiceId = id;
    window.selectedInvoiceId = id;
    const inv = invoices.find(i => i.id === id);
    if (!inv) return;

    // Set Header Info
    const modalTitle = document.getElementById('detail-modal-title');
    if (modalTitle) modalTitle.innerHTML = `${inv.vendor || 'Neznámý dodavatel'} <span class="text-slate-500 font-normal text-sm ml-2">(${inv.invoiceNumber || inv.vs || inv.id})</span>`;

    // Reset Viewer
    window.currentInvoicePages = inv.imgUrls && inv.imgUrls.length > 0 ? inv.imgUrls : [inv.imgUrl || 'https://placehold.co/600x800/f1f5f9/334155?text=Bez+nahledu'];
    window.activeDetailPageIdx = 0;
    const imgPreview = document.getElementById('detail-img-preview');
    if (imgPreview) imgPreview.src = window.currentInvoicePages[0];
    
    if (window.updateDetailPagesUI) window.updateDetailPagesUI();
    if (window.resetDetailImg) window.resetDetailImg();

    // Populate Client Select in form
    const clientSelect = document.getElementById('detail-client-select');
    if (clientSelect) {
        clientSelect.innerHTML = '';
        const allClients = Array.from(new Set([...invoices.map(i=>i.clientName), ...customClients.map(c=>c.name)])).filter(Boolean).sort();
        allClients.forEach(name => clientSelect.add(new Option(name, name)));
        clientSelect.value = inv.clientName || allClients[0] || '';
    }

    // Populate Input Fields
    const safeSetVal = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
    safeSetVal('detail-vendor', inv.vendor || '');
    safeSetVal('detail-ico', inv.ico || '');
    safeSetVal('detail-dic', inv.dic || '');
    safeSetVal('detail-invoice-num', inv.invoiceNumber || inv.vs || '');
    safeSetVal('detail-vs', inv.vs || inv.invoiceNumber || '');
    safeSetVal('detail-type', inv.type || 'Přijatá faktura');
    safeSetVal('detail-payment-method', inv.paymentMethod || 'Převodem');
    safeSetVal('detail-due-issue', inv.dateIssue || '');
    safeSetVal('detail-date-tax', inv.dateTax || inv.dateIssue || '');
    safeSetVal('detail-due', inv.dateDue || '');
    safeSetVal('detail-base-amount', inv.baseAmount !== undefined ? inv.baseAmount : '');
    safeSetVal('detail-vat', inv.vatRate || '21');
    safeSetVal('detail-vat-amount', inv.vatAmount !== undefined ? inv.vatAmount : '');
    safeSetVal('detail-amount', inv.amount || '');
    safeSetVal('detail-account', inv.accountNumber || '');
    safeSetVal('detail-comment-note', inv.note || '');

    // Layout by role
    const accButtons = document.getElementById('detail-acc-buttons');
    const clientButtons = document.getElementById('detail-client-buttons');
    const clientAssignmentBox = document.getElementById('detail-client-assignment-box');
    
    if (currentRole === 'client') {
        if (accButtons) accButtons.classList.add('hidden');
        if (clientButtons) clientButtons.classList.remove('hidden');
        if (clientAssignmentBox) clientAssignmentBox.classList.add('hidden');
    } else {
        if (accButtons) accButtons.classList.remove('hidden');
        if (clientButtons) clientButtons.classList.add('hidden');
        if (clientAssignmentBox) clientAssignmentBox.classList.remove('hidden');
    }

    if (window.lucide) window.lucide.createIcons();
    openModal('detail-modal');
};

window.saveDetailChanges = async function(e) {
    if (e) e.preventDefault();
    if (!selectedInvoiceId) return;

    const safeGetVal = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const safeGetNum = (id) => { const el = document.getElementById(id); return el ? parseFloat(el.value) || 0 : 0; };

    const clientEl = document.getElementById('detail-client-select');
    const chosenClient = (currentRole === 'client') ? activeClientCompany : (clientEl ? clientEl.value : activeClientCompany);

    const updated = {
        clientName: chosenClient,
        vendor: safeGetVal('detail-vendor') || 'Neznámý dodavatel',
        ico: safeGetVal('detail-ico'),
        dic: safeGetVal('detail-dic'),
        invoiceNumber: safeGetVal('detail-invoice-num'),
        vs: safeGetVal('detail-vs'),
        type: safeGetVal('detail-type') || 'Přijatá faktura',
        paymentMethod: safeGetVal('detail-payment-method') || 'Převodem',
        dateIssue: safeGetVal('detail-due-issue'),
        dateTax: safeGetVal('detail-date-tax'),
        dateDue: safeGetVal('detail-due'),
        baseAmount: safeGetNum('detail-base-amount'),
        vatRate: safeGetVal('detail-vat') || '21',
        vatAmount: safeGetNum('detail-vat-amount'),
        amount: safeGetNum('detail-amount'),
        accountNumber: safeGetVal('detail-account'),
        note: safeGetVal('detail-comment-note')
    };

    try {
        await updateDoc(doc(db, "invoices", selectedInvoiceId), updated);
        showToast("Údaje dokladu byly úspěšně uloženy jako koncept!", "success");
    } catch (err) {
        console.error("Chyba při ukládání změn dokladu:", err);
        showToast("Chyba při ukládání změn: " + err.message, "warning");
    }
};

window.clientSubmitInvoice = async function() {
    if (!selectedInvoiceId) return;
    const noteEl = document.getElementById('detail-comment-note');
    const noteText = noteEl ? noteEl.value : '';
    try {
        await updateDoc(doc(db, "invoices", selectedInvoiceId), { status: 'pending', note: noteText });
        closeModal('detail-modal');
        showToast("Doklad byl odeslán účetní ke kontrole!", "success");
    } catch (err) {
        console.error("Chyba při odesílání účetní:", err);
        showToast("Chyba při odesílání: " + err.message, "warning");
    }
};

window.updateInvoiceStatus = async function(newStatus) {
    if (!selectedInvoiceId) return;
    // Nejprve se uloží data a poté se změní stav
    window.saveDetailChanges();

    try {
        await updateDoc(doc(db, "invoices", selectedInvoiceId), { status: newStatus });
        closeModal('detail-modal');
        let statusText = newStatus === 'approved' ? "Schváleno" : newStatus === 'pending' ? "Rozpracováno" : "Vráceno k doplnění";
        showToast(`Stav dokladu: ${statusText}`, newStatus === 'approved' ? "success" : "info");
        
        if (newStatus === 'approved' && currentRole === 'accountant') {
            if(window.downloadSingleISDOC) window.downloadSingleISDOC(selectedInvoiceId);
        }
    } catch (err) {
        showToast("Chyba při ukládání stavu: " + err.message, "warning");
    }
};

window.deleteCurrentInvoice = async function() {
    if(!selectedInvoiceId) return;
    if(!confirm("Opravdu chcete nenávratně smazat doklad?")) return;
    await deleteDoc(doc(db, "invoices", selectedInvoiceId));
    closeModal('detail-modal');
    showToast("Smazáno", "info");
};

window.deleteInvoice = async function(id) {
    if (!id) return;
    if (!confirm(`Opravdu chcete nenávratně smazat doklad?`)) return;
    try {
        await deleteDoc(doc(db, "invoices", id));
        closeModal('detail-modal');
        showToast("Doklad byl úspěšně smazán.", "info");
    } catch (err) {
        showToast("Chyba při mazání dokladu: " + err.message, "warning");
    }
};


// ================= CALCULATIONS A ZOOM OBRÁZKU =================
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

window.zoomDetailImg = function(delta) {
    detailZoom = Math.max(0.5, Math.min(3.5, detailZoom + delta));
    const img = document.getElementById('detail-img-preview');
    if (img) img.style.transform = `scale(${detailZoom}) rotate(${detailRotation}deg)`;
    const lvl = document.getElementById('detail-zoom-lvl');
    if (lvl) lvl.textContent = `${Math.round(detailZoom * 100)}%`;
};
window.rotateDetailImg = function() {
    detailRotation = (detailRotation + 90) % 360;
    const img = document.getElementById('detail-img-preview');
    if (img) img.style.transform = `scale(${detailZoom}) rotate(${detailRotation}deg)`;
};
window.resetDetailImg = function() {
    detailZoom = 1;
    detailRotation = 0;
    const img = document.getElementById('detail-img-preview');
    if (img) img.style.transform = `scale(${detailZoom}) rotate(${detailRotation}deg)`;
    const lvl = document.getElementById('detail-zoom-lvl');
    if (lvl) lvl.textContent = `100%`;
};
window.switchDetailPage = function(dir) {
    if (dir === -1 && window.activeDetailPageIdx > 0) window.activeDetailPageIdx--;
    if (dir === 1 && window.activeDetailPageIdx < window.currentInvoicePages.length - 1) window.activeDetailPageIdx++;
    const el = document.getElementById('detail-img-preview');
    if (el) el.src = window.currentInvoicePages[window.activeDetailPageIdx] || '';
    window.updateDetailPagesUI();
    window.resetDetailImg();
};
window.updateDetailPagesUI = function() {
    const counter = document.getElementById('detail-page-counter');
    if (counter && window.currentInvoicePages.length > 0) {
        counter.textContent = `${window.activeDetailPageIdx + 1} z ${window.currentInvoicePages.length}`;
    }
};
window.openDetailImgFull = function() {
    const imgUrl = window.currentInvoicePages[window.activeDetailPageIdx] || document.getElementById('detail-img-preview')?.src;
    if (imgUrl && !imgUrl.includes('placehold.co')) {
        const w = window.open("");
        w.document.write(`<!DOCTYPE html><html><head><title>Originální náhled dokladu</title><style>body { margin: 0; padding: 0; background: #0b0f19; display: flex; flex-direction: column; align-items: center; min-height: 100vh; font-family: sans-serif; } .header { position: sticky; top: 0; width: 100%; background: rgba(15, 23, 42, 0.95); padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; box-sizing: border-box; z-index: 50; border-bottom: 1px solid #1e293b; backdrop-filter: blur(8px); } .close-btn { background: #10b981; color: white; border: none; border-radius: 8px; padding: 8px 16px; font-weight: bold; font-size: 14px; cursor: pointer; } .img-container { padding: 16px; width: 100%; display: flex; justify-content: center; box-sizing: border-box; overflow: auto; } img { max-width: 100%; height: auto; border-radius: 6px; box-shadow: 0 10px 40px rgba(0,0,0,0.8); cursor: zoom-in; }</style></head><body><div class="header"><span style="color: #94a3b8; font-size: 12px; font-weight: 600;">Detail dokladu</span><button class="close-btn" onclick="window.close()">✕ Zavřít okno</button></div><div class="img-container"><img src="${imgUrl}" onclick="this.style.maxWidth = this.style.maxWidth === 'none' ? '100%' : 'none'; this.style.cursor = this.style.maxWidth === 'none' ? 'zoom-out' : 'zoom-in';"></div></body></html>`);
    }
};

// ================= KARTA KLIENTŮ (FIREMNÍ ADRESÁŘ) =================
window.copyPairingCode = function(code) {
    navigator.clipboard.writeText(code).then(() => {
        showToast(`Párovací PIN "${code}" byl zkopírován do schránky!`, "success");
    }).catch(() => prompt("Zkopírujte si párovací PIN pro klienta:", code));
};
window.copyModalPin = function() {
    const el = document.getElementById('modal-client-pin');
    if(el) window.copyPairingCode(el.textContent);
};

window.renderClientsModalTable = function() {
    const tbody = document.getElementById('clients-list-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    const user = auth.currentUser || currentUser;
    let displayClients = window.isDemoMode ? [
        { id: 'd1', name: 'TechVision s.r.o.', pairingCode: 'TEC-821', ico: '28475921' },
        { id: 'd2', name: 'Kavárna Liberec s.r.o.', pairingCode: 'KAV-319', ico: '09384722' }
    ] : (user && currentRole === 'accountant' ? customClients.filter(c => c.accountantId === user.uid || c.userId === user.uid) : []);

    if (displayClients.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-slate-400 text-xs">Zatím nemáte vytvořené žádné klientské firmy.</td></tr>`;
        return;
    }
    displayClients.forEach(client => {
        const count = invoices.filter(i => (window.isDemoMode ? i.clientName === client.name : i.clientName === client.name && i.accountantId === user?.uid)).length;
        const pin = client.pairingCode || 'PIN-999';
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-800/50 transition";
        tr.innerHTML = `<td class="p-3 pl-4 font-semibold text-slate-200"><div>${client.name}</div><div class="text-[11px] text-slate-400 font-normal">IČO: ${client.ico || '-'}</div></td><td class="p-3 text-center"><button onclick="copyPairingCode('${pin}')" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-mono font-bold text-xs border border-emerald-500/30"><i data-lucide="copy" class="w-3.5 h-3.5"></i> <span>${pin}</span></button></td><td class="p-3 text-center"><span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300">${count} dokladů</span></td><td class="p-3 text-right pr-4"><div class="flex items-center justify-end gap-1.5"><button onclick="openClientDetailModal('${client.id}')" class="px-2.5 py-1 text-xs font-semibold text-emerald-400 hover:bg-slate-800 rounded-lg"><i data-lucide="info" class="w-3.5 h-3.5"></i> Detail</button><button onclick="deleteClient('${client.id}', '${encodeURIComponent(client.name)}')" class="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></div></td>`;
        tbody.appendChild(tr);
    });
    if (window.lucide) window.lucide.createIcons();
};

window.openClientDetailModal = function(clientId) {
    selectedClientIdForModal = clientId;
    const client = window.isDemoMode ? [{ id: 'd1', name: 'TechVision s.r.o.', pairingCode: 'TEC-821', ico: '28475921' }].find(c=>c.id===clientId) : customClients.find(c => c.id === clientId);
    if (!client) return showToast("Firma nebyla nalezena.", "warning");

    const t = document.getElementById('client-detail-title'); if(t) t.textContent = `Klientská karta: ${client.name}`;
    const p = document.getElementById('modal-client-pin'); if(p) p.textContent = client.pairingCode || 'PIN-999';
    
    const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ''; };
    setVal('modal-client-name', client.name);
    setVal('modal-client-contact', client.contactPerson);
    setVal('modal-client-phone', client.phone);
    setVal('modal-client-email', client.email);
    setVal('modal-client-ico', client.ico);
    setVal('modal-client-dic', client.dic);
    setVal('modal-client-bank', client.bankAccount);
    setVal('modal-client-address', client.address);
    setVal('modal-client-notes', client.notes);
    
    openModal('client-info-modal');
};

window.saveClientDetailChanges = async function(e) {
    e.preventDefault();
    if (!selectedClientIdForModal) return;
    const getVal = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const updatedData = {
        name: getVal('modal-client-name'),
        contactPerson: getVal('modal-client-contact'),
        phone: getVal('modal-client-phone'),
        email: getVal('modal-client-email'),
        ico: getVal('modal-client-ico'),
        dic: getVal('modal-client-dic'),
        bankAccount: getVal('modal-client-bank'),
        address: getVal('modal-client-address'),
        notes: getVal('modal-client-notes')
    };
    try {
        if (window.isDemoMode) {
            showToast("V demo režimu uloženo.", "success");
        } else {
            await updateDoc(doc(db, "clients", selectedClientIdForModal), updatedData);
            showToast(`Údaje klienta uloženy!`, "success");
        }
        closeModal('client-info-modal');
    } catch (err) { alert("Chyba při ukládání: " + err.message); }
};

window.addNewClientFromInput = async function() {
    const input = document.getElementById('new-client-input');
    if (!input || !input.value.trim()) return;
    const clean = input.value.trim();
    const user = auth.currentUser || currentUser;
    const accountantId = user ? user.uid : 'demo';
    const newPin = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) { var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16); }).substring(0, 6).toUpperCase();
    try {
        await addDoc(collection(db, "clients"), { name: clean, pairingCode: newPin, accountantId: accountantId, userId: accountantId, createdAt: new Date().toISOString() });
        showToast(`Firma založena s PINem ${newPin}!`, "success");
        input.value = '';
    } catch (err) { alert("CHYBA: " + err.message); }
};

window.deleteClient = async function(clientId, encodedName) {
    const name = decodeURIComponent(encodedName);
    const user = auth.currentUser || currentUser;
    const docCount = invoices.filter(i => i.clientName === name && (i.accountantId === user?.uid || window.isDemoMode)).length;
    let confirmMsg = `Opravdu chcete smazat firmu "${name}" ze seznamu?`;
    if (docCount > 0) confirmMsg = `POZOR: Firma "${name}" má v systému ${docCount} dokladů! Smazat firmu?`;
    if (!confirm(confirmMsg)) return;
    try {
        if (clientId && !clientId.startsWith('d')) await deleteDoc(doc(db, "clients", clientId));
        showToast(`Firma "${name}" smazána.`, "info");
    } catch (err) { alert("Chyba: " + err.message); }
};

// ================= EXPORT ISDOC PRO MONEY S3 =================
window.downloadSingleISDOC = function(id) {
    const targetId = id || selectedInvoiceId;
    let inv = invoices.find(i => i.id === targetId);
    if (!inv) return showToast("Faktura nenalezena.", "warning");

    if (selectedInvoiceId === targetId) {
        const getVal = (elId) => { const el = document.getElementById(elId); return el ? el.value.trim() : ''; };
        const getNum = (elId) => { const el = document.getElementById(elId); return el ? parseFloat(el.value) || 0 : 0; };
        inv = {
            ...inv,
            clientName: document.getElementById('detail-client-select')?.value || inv.clientName,
            vendor: getVal('detail-vendor') || inv.vendor,
            ico: getVal('detail-ico') || inv.ico,
            invoiceNumber: getVal('detail-invoice-num') || inv.invoiceNumber,
            vs: getVal('detail-vs') || inv.vs,
            type: getVal('detail-type') || inv.type,
            paymentMethod: getVal('detail-payment-method') || inv.paymentMethod,
            dateIssue: getVal('detail-due-issue') || inv.dateIssue,
            dateTax: getVal('detail-date-tax') || inv.dateTax,
            dateDue: getVal('detail-due') || inv.dateDue,
            baseAmount: getNum('detail-base-amount') || inv.baseAmount,
            vatRate: getVal('detail-vat') || inv.vatRate,
            vatAmount: getNum('detail-vat-amount') || inv.vatAmount,
            amount: getNum('detail-amount') || inv.amount,
            accountNumber: getVal('detail-account') || inv.accountNumber,
            note: getVal('detail-comment-note') || inv.note
        };
    }
    const xml = generateISDOCXml(inv);
    triggerDownload(xml, `ISDOC_${inv.clientName ? inv.clientName.replace(/[^a-zA-Z0-9]/g, '_') : 'firma'}_${inv.invoiceNumber || inv.vs || inv.id}.isdoc`, 'application/xml;charset=utf-8');
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
        showToast(`Vygenerováno ${list.length} ISDOC souborů!`, "success");
    }
};

function initApp() {
    if (window.lucide) window.lucide.createIcons();
    if (typeof window.renderClientInvoices === 'function') window.renderClientInvoices();
    if (typeof window.renderAccountantInvoices === 'function') window.renderAccountantInvoices();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
});
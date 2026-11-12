import { db, auth } from './firebase.js';
import { collection, onSnapshot, doc, updateDoc, deleteDoc, query, orderBy, addDoc } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import {
    currentUser,
    currentRole,
    activeClientCompany,
    activeAccountantCompany,
    setCurrentRole,
    setDemoState,
    initAuthListener,
    setAuthMode,
    updateRoleTypeUI,
    handleAuthSubmit,
    handleForgotPassword,
    handleLogout,
    openAccountSettingsModal,
    saveAccountSettings,
    openChangePasswordModal,
    handleChangePassword,
    sendResetPasswordLink
} from './auth.js';
import {
    showToast,
    closeModal,
    openModal,
    formatDateTime,
    generatePairingPin,
    closeProfileDropdown,
    toggleProfileDropdown,
    toggleTheme,
    initTheme
} from './ui.js';
import {
    triggerScan,
    startRescanForInvoice,
    handleFileSelect,
    switchScanPage,
    updateScanPagesUI,
    processWithOpenAI,
    saveExtractedInvoice,
    calculateScanAmounts,
    renderAiOverlayElements,
    focusAiField,
    toggleScanAiOverlay,
    fetchAresData,
    verifyAresFromInput
} from './scanner.js';
import { generateISDOCXml, triggerDownload } from './isdoc.js';

let invoices = [];
let currentClientFilter = 'all';
let detailAiOverlayVisible = true;
let customClients = [];
let detailZoom = 1;
let detailRotation = 0;
let selectedInvoiceId = null;
let selectedClientIdForModal = null;
window.isDemoMode = false;
window.currentInvoicePages = [];
window.activeDetailPageIdx = 0;

// Zavření profilového dropdownu při kliknutí mimo něj
document.addEventListener('click', (e) => {
    const container = document.getElementById('auth-logged-in');
    if (container && !container.contains(e.target)) closeProfileDropdown();
});

// ================= LANDING PAGE & DEMO REŽIM =================
export function continueAsDemo() {
    window.isDemoMode = true;
    setDemoState();

    document.getElementById('landing-page')?.classList.add('hidden');
    document.getElementById('app')?.classList.remove('hidden');
    document.getElementById('demo-switcher-container')?.classList.remove('hidden');

    const badge = document.getElementById('current-client-badge');
    if (badge) badge.textContent = `Firma: TechVision s.r.o.`;

    const accBadge = document.getElementById('acc-agency-badge');
    if (accBadge) accBadge.textContent = `Účetní kancelář: Účetní kancelář ProFit s.r.o.`;

    const emailEl = document.getElementById('user-display-email');
    const roleEl = document.getElementById('user-display-role');
    const menuEmailEl = document.getElementById('menu-user-email');
    const menuCompEl = document.getElementById('menu-user-company');
    if (emailEl) emailEl.textContent = 'Demo Návštěvník';
    if (roleEl) roleEl.textContent = 'Zkušební Demo';
    if (menuEmailEl) menuEmailEl.textContent = 'Demo Návštěvník';
    if (menuCompEl) menuCompEl.textContent = 'Zkušební Demo';

    switchRole('client');
    showToast("Vstoupili jste do zkušebního demo režimu.", "info");
    if (window.lucide) window.lucide.createIcons();

    updateDynamicClients();
    renderClientsModalTable();
    renderClientInvoices();
    renderAccountantInvoices();
}

// ================= LISTOVÁNÍ A FILTRACE =================
function toDateNumber(val) {
    if (!val) return null;
    if (val instanceof Date) {
        if (isNaN(val.getTime())) return null;
        return val.getFullYear() * 10000 + (val.getMonth() + 1) * 100 + val.getDate();
    }
    if (typeof val === 'object' && typeof val.toDate === 'function') {
        const d = val.toDate();
        return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    }
    const str = String(val).trim();
    if (!str) return null;

    if (str.includes('T')) {
        const d = new Date(str);
        if (!isNaN(d.getTime())) {
            return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
        }
    }

    // Formát YYYY-MM-DD (z <input type="date">)
    const ymdMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (ymdMatch) {
        const y = parseInt(ymdMatch[1], 10);
        const m = parseInt(ymdMatch[2], 10);
        const d = parseInt(ymdMatch[3], 10);
        return y * 10000 + m * 100 + d;
    }

    // Český formát DD.MM.YYYY, DD. MM. YYYY, DD/MM/YYYY
    const dmyMatch = str.match(/^(\d{1,2})[./-\s]+\s*(\d{1,2})[./-\s]+\s*(\d{4})/);
    if (dmyMatch) {
        const d = parseInt(dmyMatch[1], 10);
        const m = parseInt(dmyMatch[2], 10);
        const y = parseInt(dmyMatch[3], 10);
        return y * 10000 + m * 100 + d;
    }

    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
        return parsed.getFullYear() * 10000 + (parsed.getMonth() + 1) * 100 + parsed.getDate();
    }
    return null;
}

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
        const fromNum = toDateNumber(fromDate);
        const toNum = toDateNumber(toDate);
        const candidateNums = [inv.createdAt, inv.dateIssue, inv.dateTax].map(toDateNumber).filter(Boolean);
        if (candidateNums.length === 0) return true;
        return candidateNums.some(num => {
            if (fromNum !== null && num < fromNum) return false;
            if (toNum !== null && num > toNum) return false;
            return true;
        });
    }
    return true;
}

export function handleClientDatePresetChange() {
    const val = document.getElementById('client-date-preset')?.value;
    const customBox = document.getElementById('client-custom-dates');
    if (customBox) val === 'custom' ? customBox.classList.remove('hidden') : customBox.classList.add('hidden');
    renderClientInvoices();
}

export function handleAccDatePresetChange() {
    const val = document.getElementById('acc-date-preset')?.value;
    const customBox = document.getElementById('acc-custom-dates');
    if (customBox) val === 'custom' ? customBox.classList.remove('hidden') : customBox.classList.add('hidden');
    renderAccountantInvoices();
}

export function switchRole(role) {
    setCurrentRole(role);
    const cView = document.getElementById('client-view');
    const aView = document.getElementById('accountant-view');
    const btnClient = document.getElementById('role-btn-client');
    const btnAcc = document.getElementById('role-btn-accountant');

    if (role === 'client') {
        if (cView) cView.classList.remove('hidden');
        if (aView) aView.classList.add('hidden');
        if (btnClient) btnClient.className = "px-2 py-1 rounded-lg text-[11px] font-semibold transition bg-emerald-600 text-white";
        if (btnAcc) btnAcc.className = "px-2 py-1 rounded-lg text-[11px] font-semibold transition text-slate-400 hover:text-white";
        renderClientInvoices();
    } else {
        if (cView) cView.classList.add('hidden');
        if (aView) aView.classList.remove('hidden');
        if (btnAcc) btnAcc.className = "px-2 py-1 rounded-lg text-[11px] font-semibold transition bg-emerald-600 text-white";
        if (btnClient) btnClient.className = "px-2 py-1 rounded-lg text-[11px] font-semibold transition text-slate-400 hover:text-white";
        renderAccountantInvoices();
    }
}

export function renderClientInvoices(filterStatus = null) {
    if (filterStatus !== null) currentClientFilter = filterStatus;
    const tbody = document.getElementById('client-invoice-table-body');
    const searchQuery = document.getElementById('client-search')?.value.toLowerCase() || '';
    const datePreset = document.getElementById('client-date-preset')?.value || 'all';

    if (!tbody) return;
    tbody.innerHTML = '';

    const user = auth.currentUser || currentUser;
    let filtered = window.isDemoMode
        ? invoices.filter(inv => !inv.userId || inv.isDemo || inv.clientName === 'TechVision s.r.o.')
        : user && currentRole === 'client'
            ? invoices.filter(inv => (inv.userId === user.uid) || (inv.clientName === activeClientCompany && !inv.isDemo))
            : user && currentRole === 'accountant'
                ? invoices.filter(inv => (inv.accountantId === user.uid || inv.userId === user.uid))
                : [];

    if (currentClientFilter !== 'all') {
        filtered = filtered.filter(inv => currentClientFilter === 'action_needed' ? (inv.status === 'action_needed' || inv.status === 'rejected') : inv.status === currentClientFilter);
    }
    filtered = filtered.filter(inv => checkDateMatch(inv, datePreset, document.getElementById('client-date-from')?.value, document.getElementById('client-date-to')?.value));
    if (searchQuery) {
        filtered = filtered.filter(inv =>
            (inv.vendor && inv.vendor.toLowerCase().includes(searchQuery)) ||
            (inv.amount && inv.amount.toString().includes(searchQuery)) ||
            (inv.vs && inv.vs.includes(searchQuery)) ||
            (inv.invoiceNumber && inv.invoiceNumber.toLowerCase().includes(searchQuery))
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400 text-xs">Zatím nemáte žádné nahrané doklady odpovídající výběru.</td></tr>`;
    } else {
        filtered.forEach(inv => {
            const isActionNeeded = inv.status === 'action_needed' || inv.status === 'rejected';
            const statusBadge = inv.status === 'pending'
                ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/20">Čeká na schválení</span>`
                : inv.status === 'approved'
                    ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">Zaúčtováno</span>`
                    : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30"><i data-lucide="alert-triangle" class="w-3 h-3"></i> K doplnění</span>`;

            const safeNote = (inv.note || '').trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const noteBlock = isActionNeeded && safeNote
                ? `<div class="mt-1.5 p-2 rounded-lg bg-rose-500/10 dark:bg-rose-950/50 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-[11px] leading-snug max-w-xs shadow-sm">
                       <div class="font-bold uppercase text-[9px] tracking-wider text-rose-600 dark:text-rose-400 flex items-center gap-1 mb-0.5">
                           <i data-lucide="alert-circle" class="w-3 h-3 shrink-0"></i> Poznámka od účetní:
                       </div>
                       <div class="font-medium break-words">${safeNote}</div>
                   </div>`
                : (safeNote ? `<div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400 italic max-w-xs break-words">Pozn.: ${safeNote}</div>` : '');

            const tr = document.createElement('tr');
            tr.className = isActionNeeded
                ? "bg-rose-500/[0.03] hover:bg-rose-500/[0.07] dark:bg-rose-950/10 dark:hover:bg-rose-950/25 transition"
                : "hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition";
            tr.innerHTML = `<td class="p-3 pl-4"><div class="font-bold text-slate-900 dark:text-white">${inv.vendor || '-'}</div><div class="text-xs text-slate-500 dark:text-slate-400 font-mono"><span>${inv.invoiceNumber ? 'Číslo: ' + inv.invoiceNumber : (inv.vs ? 'VS: ' + inv.vs : '')}</span></div></td><td class="p-3 text-xs text-slate-600 dark:text-slate-400"><div>Vystaveno: ${inv.dateIssue || '-'}</div><div class="text-slate-400 dark:text-slate-500">Splatnost: ${inv.dateDue || '-'}</div><div class="text-[11px] text-emerald-600 dark:text-emerald-500 font-medium mt-0.5">Nahráno: ${formatDateTime(inv.createdAt)}</div></td><td class="p-3 text-xs text-slate-700 dark:text-slate-300"><div class="font-medium">${inv.type || 'Přijatá faktura'}</div><span class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-300 font-semibold">${inv.paymentMethod || 'Převodem'}</span></td><td class="p-3 font-bold text-slate-900 dark:text-white">${Number(inv.amount || 0).toLocaleString('cs-CZ')} Kč</td><td class="p-3">${statusBadge}${noteBlock}</td><td class="p-3 text-right pr-4"><div class="flex items-center justify-end gap-1"><button onclick="openDetailModal('${inv.id}')" title="Detail dokladu" class="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"><i data-lucide="eye" class="w-4 h-4"></i></button><button onclick="deleteInvoice('${inv.id}')" title="Smazat doklad" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div></td>`;
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

export function filterClientInvoices(status) {
    document.querySelectorAll('.client-filter-btn').forEach(btn => {
        btn.classList.remove('active', 'bg-emerald-600', 'text-white');
        btn.classList.add('bg-slate-200', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300', 'hover:bg-slate-300');
    });
    const activeBtn = document.getElementById(`filter-btn-${status}`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-slate-200', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300', 'hover:bg-slate-300');
        activeBtn.classList.add('active', 'bg-emerald-600', 'text-white');
    }
    renderClientInvoices(status);
}

export function renderAccountantInvoices() {
    const tbody = document.getElementById('accountant-invoice-table-body');
    const clientFilter = document.getElementById('acc-client-select')?.value || 'all';
    const statusFilter = document.getElementById('acc-status-select')?.value || 'all';
    const datePreset = document.getElementById('acc-date-preset')?.value || 'all';
    const dateFrom = document.getElementById('acc-date-from')?.value || '';
    const dateTo = document.getElementById('acc-date-to')?.value || '';
    if (!tbody) return;
    tbody.innerHTML = '';

    const user = auth.currentUser || currentUser;
    let filtered = window.isDemoMode
        ? [...invoices]
        : user && currentRole === 'accountant'
            ? invoices.filter(inv => inv.accountantId === user.uid || inv.userId === user.uid)
            : [];

    if (clientFilter !== 'all') filtered = filtered.filter(i => i.clientName === clientFilter);
    if (statusFilter !== 'all') filtered = filtered.filter(i => statusFilter === 'action_needed' ? (i.status === 'action_needed' || i.status === 'rejected') : i.status === statusFilter);
    filtered = filtered.filter(inv => checkDateMatch(inv, datePreset, dateFrom, dateTo));

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400 text-xs">Žádné doklady neodpovídají vybraným filtrům.</td></tr>`;
    } else {
        filtered.forEach(inv => {
            const isActionNeeded = inv.status === 'action_needed' || inv.status === 'rejected';
            const statusBadge = inv.status === 'pending'
                ? `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/20">Nová k vyřízení</span>`
                : inv.status === 'approved'
                    ? `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">Zaúčtováno</span>`
                    : `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-500 border border-rose-500/20">Vráceno k doplnění</span>`;
            const safeNote = (inv.note || '').trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const noteBlock = safeNote
                ? `<div class="mt-1 text-[11px] ${isActionNeeded ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-slate-500 dark:text-slate-400'} max-w-[220px] break-words">Pozn.: ${safeNote}</div>`
                : '';
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition";
            tr.innerHTML = `<td class="p-3 pl-4"><div class="font-bold text-slate-900 dark:text-white text-xs">${inv.clientName || 'Klient'}</div><span class="text-[10px] text-slate-400">ID: ${inv.id}</span></td><td class="p-3"><div class="font-semibold text-slate-800 dark:text-slate-200 text-xs">${inv.vendor || '-'}</div><div class="text-[11px] text-slate-500 dark:text-slate-400">IČO: ${inv.ico || '-'}</div></td><td class="p-3 text-xs"><div class="text-slate-800 dark:text-slate-200 font-semibold">${inv.invoiceNumber ? 'Fa: ' + inv.invoiceNumber : (inv.vs ? 'VS: ' + inv.vs : '-')}</div><div class="text-slate-500 dark:text-slate-400 text-[11px]">DUZP: ${inv.dateTax || inv.dateIssue || '-'}</div><div class="text-slate-400 dark:text-slate-500 text-[11px]">Splatnost: ${inv.dateDue || '-'}</div><div class="text-[11px] text-emerald-600 dark:text-emerald-500 font-medium mt-0.5">Nahráno: ${formatDateTime(inv.createdAt)}</div></td><td class="p-3"><div class="font-bold text-slate-900 dark:text-white text-xs">${Number(inv.amount || 0).toLocaleString('cs-CZ')} Kč</div><div class="text-[10px] text-slate-500 dark:text-slate-400">Základ: ${inv.baseAmount ? Number(inv.baseAmount).toLocaleString('cs-CZ') + ' Kč' : '-'}</div><div class="text-[10px] text-slate-400 dark:text-slate-500">DPH (${inv.vatRate || 21}%): ${inv.vatAmount ? Number(inv.vatAmount).toLocaleString('cs-CZ') + ' Kč' : '-'}</div></td><td class="p-3">${statusBadge}${noteBlock}</td><td class="p-3 text-right pr-4 whitespace-nowrap"><div class="flex items-center justify-end gap-1.5"><button onclick="openDetailModal('${inv.id}')" class="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 hover:bg-slate-200 dark:hover:bg-slate-700 font-semibold rounded-lg text-xs transition flex items-center gap-1"><i data-lucide="file-text" class="w-3.5 h-3.5"></i> Detail</button><button onclick="deleteInvoice('${inv.id}')" title="Smazat doklad" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div></td>`;
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

function getAllClientNames() {
    const clientSet = new Set();
    const user = auth.currentUser || currentUser;

    if (window.isDemoMode) {
        clientSet.add('TechVision s.r.o.');
        clientSet.add('Kavárna Liberec s.r.o.');
        clientSet.add('Jan Novák - Design');
        return Array.from(clientSet).sort();
    }

    if (user && currentRole === 'client') {
        if (activeClientCompany) clientSet.add(activeClientCompany);
        return Array.from(clientSet);
    }

    if (user && currentRole === 'accountant') {
        customClients.forEach(c => {
            if (c.accountantId === user.uid || c.userId === user.uid || !c.accountantId) {
                if (c.name && c.name.trim()) clientSet.add(c.name.trim());
            }
        });
        invoices.forEach(inv => {
            if ((inv.accountantId === user.uid || inv.userId === user.uid) && inv.clientName) {
                clientSet.add(inv.clientName.trim());
            }
        });
        if (activeAccountantCompany && activeAccountantCompany !== 'Účetní kancelář') {
            clientSet.add(activeAccountantCompany);
        }
        return Array.from(clientSet).sort();
    }

    return ['Moje Firma'];
}

export function updateDynamicClients() {
    const allClients = getAllClientNames();

    const scanClientSelect = document.getElementById('field-client-name');
    if (scanClientSelect) {
        const currentSelected = scanClientSelect.value;
        scanClientSelect.innerHTML = '';
        allClients.forEach(name => scanClientSelect.add(new Option(name, name)));
        if (currentSelected && allClients.includes(currentSelected)) {
            scanClientSelect.value = currentSelected;
        }
    }

    const detailClientSelect = document.getElementById('detail-client-select');
    if (detailClientSelect) {
        const currentDetailSelected = detailClientSelect.value;
        detailClientSelect.innerHTML = '';
        allClients.forEach(name => detailClientSelect.add(new Option(name, name)));
        if (currentDetailSelected && allClients.includes(currentDetailSelected)) {
            detailClientSelect.value = currentDetailSelected;
        }
    }

    const accSelect = document.getElementById('acc-client-select');
    if (accSelect) {
        const currentAccSelected = accSelect.value;
        accSelect.innerHTML = '<option value="all">Všichni klienti</option>';
        allClients.forEach(name => accSelect.add(new Option(name, name)));
        if (currentAccSelected && (currentAccSelected === 'all' || allClients.includes(currentAccSelected))) {
            accSelect.value = currentAccSelected;
        }
    }

    const exportClientSelect = document.getElementById('export-isdoc-client');
    if (exportClientSelect) {
        const currentExportSelected = exportClientSelect.value;
        exportClientSelect.innerHTML = '<option value="all">Všechny firmy</option>';
        allClients.forEach(name => exportClientSelect.add(new Option(name, name)));
        if (currentExportSelected && (currentExportSelected === 'all' || allClients.includes(currentExportSelected))) {
            exportClientSelect.value = currentExportSelected;
        }
    }
}

// ================= OTEVÍRÁNÍ A PRÁCE S DETAILEM DOKLADU =================
export function openDetailModal(id) {
    selectedInvoiceId = id;
    window.selectedInvoiceId = id;
    const inv = invoices.find(i => i.id === id);
    if (!inv) return;

    const modalTitle = document.getElementById('detail-modal-title');
    if (modalTitle) {
        modalTitle.innerHTML = `${inv.vendor || 'Neznámý dodavatel'} <span class="text-slate-500 font-normal text-sm ml-2">(${inv.invoiceNumber || inv.vs || inv.id})</span>`;
    }

    const badge = document.getElementById('detail-status-badge');
    if (badge) {
        if (inv.status === 'pending') {
            badge.className = "ml-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1.5";
            badge.innerHTML = `<i data-lucide="clock" class="w-3.5 h-3.5"></i> Rozpracováno`;
        } else if (inv.status === 'approved') {
            badge.className = "ml-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5";
            badge.innerHTML = `<i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> Zaúčtováno`;
        } else {
            badge.className = "ml-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center gap-1.5";
            badge.innerHTML = `<i data-lucide="alert-circle" class="w-3.5 h-3.5"></i> K doplnění`;
        }
    }

    window.currentInvoicePages = inv.imgUrls && inv.imgUrls.length > 0 ? inv.imgUrls : [inv.imgUrl || 'https://placehold.co/600x800/f1f5f9/334155?text=Bez+nahledu'];
    window.activeDetailPageIdx = 0;
    const imgPreview = document.getElementById('detail-img-preview');
    if (imgPreview) imgPreview.src = window.currentInvoicePages[0];

    updateDetailPagesUI();
    resetDetailImg();

    const clientSelect = document.getElementById('detail-client-select');
    if (clientSelect) {
        clientSelect.innerHTML = '';
        const allClients = getAllClientNames();
        if (inv.clientName && !allClients.includes(inv.clientName)) {
            allClients.push(inv.clientName);
        }
        allClients.forEach(name => clientSelect.add(new Option(name, name)));
        clientSelect.value = inv.clientName || allClients[0] || '';
    }

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

    const accButtons = document.getElementById('detail-acc-buttons');
    const clientButtons = document.getElementById('detail-client-buttons');
    const clientAssignmentBox = document.getElementById('detail-client-assignment-box');

    if (currentRole === 'client') {
        if (accButtons) accButtons.classList.add('hidden');
        if (clientButtons) {
            clientButtons.classList.remove('hidden');
            clientButtons.classList.add('flex');
        }
        if (clientAssignmentBox) clientAssignmentBox.classList.add('hidden');
    } else {
        if (accButtons) accButtons.classList.remove('hidden');
        if (clientButtons) {
            clientButtons.classList.add('hidden');
            clientButtons.classList.remove('flex');
        }
        if (clientAssignmentBox) clientAssignmentBox.classList.remove('hidden');
    }

    // Vykreslení AI Overlay vrstvy nad náhledem dokladu i v legendě
    renderAiOverlayElements(
        'detail-ai-overlay',
        'detail-ai-legend',
        inv,
        inv.aiOverlay,
        'detail'
    );
    updateDetailAiOverlayToggleUI();

    if (window.lucide) window.lucide.createIcons();
    openModal('detail-modal');
}

function updateDetailAiOverlayToggleUI() {
    const overlayEl = document.getElementById('detail-ai-overlay');
    const btnEl = document.getElementById('btn-toggle-detail-ai-overlay');
    if (overlayEl) {
        if (detailAiOverlayVisible) {
            overlayEl.classList.remove('hidden');
        } else {
            overlayEl.classList.add('hidden');
        }
    }
    if (btnEl) {
        btnEl.className = detailAiOverlayVisible
            ? "px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition flex items-center gap-1 shadow-sm"
            : "px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-700 hover:bg-slate-300 dark:hover:bg-slate-700 transition flex items-center gap-1";
        btnEl.innerHTML = `<i data-lucide="sparkles" class="w-3.5 h-3.5"></i><span>AI Vrstva: ${detailAiOverlayVisible ? 'ZAP' : 'VYP'}</span>`;
        if (window.lucide) window.lucide.createIcons();
    }
}

export function toggleDetailAiOverlay() {
    detailAiOverlayVisible = !detailAiOverlayVisible;
    updateDetailAiOverlayToggleUI();
}

export function rescanCurrentDocument() {
    if (!selectedInvoiceId) {
        showToast("Nejprve vyberte doklad, který chcete znovu naskenovat.", "warning");
        return;
    }
    const inv = invoices.find(i => i.id === selectedInvoiceId);
    if (!inv) {
        showToast("Doklad nebyl v seznamu nalezen.", "warning");
        return;
    }
    startRescanForInvoice(inv);
}

export function handleRescanCompleted(invoiceId, updatedData) {
    const idx = invoices.findIndex(i => i.id === invoiceId);
    if (idx !== -1) {
        invoices[idx] = { ...invoices[idx], ...updatedData };
    }
    updateDynamicClients();
    renderClientInvoices();
    renderAccountantInvoices();
}

export function handleDemoInvoiceAdded(newInv) {
    invoices.unshift(newInv);
    updateDynamicClients();
    renderClientInvoices();
    renderAccountantInvoices();
}

function getDetailModalFormValues() {
    const safeGetVal = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const safeGetNum = (id) => { const el = document.getElementById(id); return el ? parseFloat(el.value) || 0 : 0; };

    const clientEl = document.getElementById('detail-client-select');
    const chosenClient = (currentRole === 'client') ? activeClientCompany : (clientEl ? clientEl.value : activeClientCompany);
    const noteEl = document.getElementById('detail-comment-note');
    const noteText = noteEl ? noteEl.value.trim() : '';

    return {
        clientName: chosenClient,
        vendor: safeGetVal('detail-vendor') || 'Neznámý dodavatel',
        ico: safeGetVal('detail-ico'),
        dic: safeGetVal('detail-dic'),
        invoiceNumber: safeGetVal('detail-invoice-num'),
        vs: safeGetVal('detail-vs') || safeGetVal('detail-invoice-num'),
        type: safeGetVal('detail-type') || 'Přijatá faktura',
        paymentMethod: safeGetVal('detail-payment-method') || 'Převodem',
        dateIssue: safeGetVal('detail-due-issue'),
        dateTax: safeGetVal('detail-date-tax') || safeGetVal('detail-due-issue'),
        dateDue: safeGetVal('detail-due'),
        baseAmount: safeGetNum('detail-base-amount'),
        vatRate: safeGetVal('detail-vat') || '21',
        vatAmount: safeGetNum('detail-vat-amount'),
        amount: safeGetNum('detail-amount'),
        accountNumber: safeGetVal('detail-account'),
        note: noteText
    };
}

export async function saveDetailChanges(e) {
    if (e) e.preventDefault();
    if (!selectedInvoiceId) return;

    const updated = getDetailModalFormValues();

    const localIdx = invoices.findIndex(i => i.id === selectedInvoiceId);
    if (localIdx !== -1) {
        invoices[localIdx] = { ...invoices[localIdx], ...updated };
    }

    if (window.isDemoMode) {
        renderClientInvoices();
        renderAccountantInvoices();
        showToast("Údaje dokladu byly úspěšně uloženy!", "success");
        return;
    }

    try {
        await updateDoc(doc(db, "invoices", selectedInvoiceId), updated);
        showToast("Údaje dokladu byly úspěšně uloženy!", "success");
    } catch (err) {
        showToast("Chyba při ukládání změn: " + err.message, "warning");
    }
}

export async function clientSubmitInvoice() {
    if (!selectedInvoiceId) return;
    const updated = getDetailModalFormValues();
    const noteEl = document.getElementById('detail-comment-note');
    const noteText = noteEl ? noteEl.value.trim() : '';
    const payload = { ...updated, status: 'pending', note: noteText };

    const localIdx = invoices.findIndex(i => i.id === selectedInvoiceId);
    if (localIdx !== -1) {
        invoices[localIdx] = { ...invoices[localIdx], ...payload };
    }

    if (window.isDemoMode) {
        closeModal('detail-modal');
        renderClientInvoices();
        renderAccountantInvoices();
        showToast("Doklad byl odeslán účetní ke kontrole!", "success");
        return;
    }

    try {
        await updateDoc(doc(db, "invoices", selectedInvoiceId), payload);
        closeModal('detail-modal');
        showToast("Doklad byl odeslán účetní ke kontrole!", "success");
    } catch (err) {
        showToast("Chyba při odesílání: " + err.message, "warning");
    }
}

export async function updateInvoiceStatus(newStatus) {
    if (!selectedInvoiceId) return;

    const updated = getDetailModalFormValues();
    const noteEl = document.getElementById('detail-comment-note');
    const noteText = noteEl ? noteEl.value.trim() : '';

    const payload = {
        ...updated,
        note: noteText,
        status: newStatus
    };

    const localIdx = invoices.findIndex(i => i.id === selectedInvoiceId);
    if (localIdx !== -1) {
        invoices[localIdx] = { ...invoices[localIdx], ...payload };
    }

    if (window.isDemoMode) {
        closeModal('detail-modal');
        renderClientInvoices();
        renderAccountantInvoices();
        let statusText = newStatus === 'approved' ? "Zaúčtováno" : newStatus === 'pending' ? "Rozpracováno" : "Vráceno klientovi k doplnění";
        showToast(`Stav dokladu: ${statusText}`, newStatus === 'approved' ? "success" : (newStatus === 'action_needed' ? "warning" : "info"));
        if (newStatus === 'approved' && currentRole === 'accountant') {
            downloadSingleISDOC(selectedInvoiceId);
        }
        return;
    }

    try {
        await updateDoc(doc(db, "invoices", selectedInvoiceId), payload);
        closeModal('detail-modal');
        let statusText = newStatus === 'approved' ? "Zaúčtováno" : newStatus === 'pending' ? "Rozpracováno" : "Vráceno klientovi k doplnění";
        showToast(`Stav dokladu: ${statusText}`, newStatus === 'approved' ? "success" : (newStatus === 'action_needed' ? "warning" : "info"));

        if (newStatus === 'approved' && currentRole === 'accountant') {
            downloadSingleISDOC(selectedInvoiceId);
        }
    } catch (err) {
        showToast("Chyba při ukládání stavu: " + err.message, "warning");
    }
}

export async function deleteCurrentInvoice() {
    if (!selectedInvoiceId) return;
    await deleteInvoice(selectedInvoiceId);
}

export async function deleteInvoice(id) {
    if (!id) return;
    const inv = invoices.find(i => i.id === id);
    const vendorName = inv ? inv.vendor : 'tento doklad';
    if (!confirm(`Opravdu chcete nenávratně smazat doklad od dodavatele "${vendorName}"?`)) return;
    try {
        await deleteDoc(doc(db, "invoices", id));
        closeModal('detail-modal');
        showToast("Doklad byl úspěšně smazán z databáze.", "info");
    } catch (err) {
        showToast("Chyba při mazání dokladu: " + err.message, "warning");
    }
}

// ================= VÝPOČTY DPH A ZOOM OBRÁZKU =================
export function calculateDetailAmounts(source = 'total') {
    const baseInput = document.getElementById('detail-base-amount');
    const vatInput = document.getElementById('detail-vat-amount');
    const totalInput = document.getElementById('detail-amount');
    const rateSelect = document.getElementById('detail-vat');
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

export function zoomDetailImg(delta) {
    detailZoom = Math.max(0.5, Math.min(3.5, Math.round((detailZoom + delta) * 10) / 10));
    const target = document.getElementById('detail-zoom-wrapper') || document.getElementById('detail-img-preview');
    if (target) target.style.transform = `scale(${detailZoom}) rotate(${detailRotation}deg)`;
    const lvl = document.getElementById('detail-zoom-lvl');
    if (lvl) lvl.textContent = `${Math.round(detailZoom * 100)}%`;
}

export function rotateDetailImg() {
    detailRotation = (detailRotation + 90) % 360;
    const target = document.getElementById('detail-zoom-wrapper') || document.getElementById('detail-img-preview');
    if (target) target.style.transform = `scale(${detailZoom}) rotate(${detailRotation}deg)`;
}

export function resetDetailImg() {
    detailZoom = 1;
    detailRotation = 0;
    const target = document.getElementById('detail-zoom-wrapper') || document.getElementById('detail-img-preview');
    if (target) target.style.transform = `scale(${detailZoom}) rotate(${detailRotation}deg)`;
    const lvl = document.getElementById('detail-zoom-lvl');
    if (lvl) lvl.textContent = `100%`;
}

export function switchDetailPage(dir) {
    if (dir === -1 && window.activeDetailPageIdx > 0) window.activeDetailPageIdx--;
    if (dir === 1 && window.activeDetailPageIdx < window.currentInvoicePages.length - 1) window.activeDetailPageIdx++;
    const el = document.getElementById('detail-img-preview');
    if (el) el.src = window.currentInvoicePages[window.activeDetailPageIdx] || '';
    updateDetailPagesUI();
    resetDetailImg();
}

export function updateDetailPagesUI() {
    const counter = document.getElementById('detail-page-counter');
    if (counter && window.currentInvoicePages.length > 0) {
        counter.textContent = `${window.activeDetailPageIdx + 1} z ${window.currentInvoicePages.length}`;
    }
    const prevBtn = document.getElementById('detail-btn-prev');
    const nextBtn = document.getElementById('detail-btn-next');
    if (prevBtn) prevBtn.disabled = window.activeDetailPageIdx === 0;
    if (nextBtn) nextBtn.disabled = window.activeDetailPageIdx >= window.currentInvoicePages.length - 1;
}

export function openDetailImgFull() {
    const imgUrl = window.currentInvoicePages[window.activeDetailPageIdx] || document.getElementById('detail-img-preview')?.src;
    if (imgUrl && !imgUrl.includes('placehold.co')) {
        const w = window.open("");
        if (!w) return;
        w.document.write(`<!DOCTYPE html><html><head><title>Originální náhled dokladu</title><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0"><style>body { margin: 0; padding: 0; background: #0b0f19; display: flex; flex-direction: column; align-items: center; min-height: 100vh; font-family: sans-serif; } .header { position: sticky; top: 0; width: 100%; background: rgba(15, 23, 42, 0.95); padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; box-sizing: border-box; z-index: 50; border-bottom: 1px solid #1e293b; backdrop-filter: blur(8px); } .close-btn { background: #10b981; color: white; border: none; border-radius: 8px; padding: 8px 16px; font-weight: bold; font-size: 14px; cursor: pointer; } .img-container { padding: 16px; width: 100%; display: flex; justify-content: center; box-sizing: border-box; overflow: auto; } img { max-width: 100%; height: auto; border-radius: 6px; box-shadow: 0 10px 40px rgba(0,0,0,0.8); cursor: zoom-in; }</style></head><body><div class="header"><span style="color: #94a3b8; font-size: 12px; font-weight: 600;">Detail dokladu</span><button class="close-btn" onclick="window.close()">✕ Zavřít okno</button></div><div class="img-container"><img src="${imgUrl}" onclick="this.style.maxWidth = this.style.maxWidth === 'none' ? '100%' : 'none'; this.style.cursor = this.style.maxWidth === 'none' ? 'zoom-out' : 'zoom-in';"></div></body></html>`);
    }
}

// ================= KARTA KLIENTŮ (FIREMNÍ ADRESÁŘ) =================
export function copyPairingCode(code) {
    navigator.clipboard.writeText(code).then(() => {
        showToast(`Párovací PIN "${code}" byl zkopírován do schránky!`, "success");
    }).catch(() => prompt("Zkopírujte si párovací PIN pro klienta:", code));
}

export function copyModalPin() {
    const el = document.getElementById('modal-client-pin');
    if (el) copyPairingCode(el.textContent);
}

export function renderClientsModalTable() {
    const tbody = document.getElementById('clients-list-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    const user = auth.currentUser || currentUser;
    let displayClients = [];

    if (window.isDemoMode) {
        displayClients = [
            { id: 'd1', name: 'TechVision s.r.o.', pairingCode: 'TEC-821', ico: '28475921', contactPerson: 'Martin Dvořák', phone: '+420 777 888 999', email: 'dvorak@techvision.cz' },
            { id: 'd2', name: 'Kavárna Liberec s.r.o.', pairingCode: 'KAV-319', ico: '09384722', contactPerson: 'Petra Svobodová', phone: '+420 602 111 222', email: 'info@kavarnaliberec.cz' },
            { id: 'd3', name: 'Jan Novák - Design', pairingCode: 'NOV-552', ico: '84920194', contactPerson: 'Jan Novák', phone: '+420 724 333 444', email: 'jan@novakdesign.cz' }
        ];
    } else if (user && currentRole === 'accountant') {
        displayClients = customClients.filter(c => c.accountantId === user.uid || c.userId === user.uid || !c.accountantId);
    }

    if (displayClients.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-slate-400 text-xs">Zatím nemáte vytvořené žádné klientské firmy. Zadejte název výše a vytvořte první firmu.</td></tr>`;
        return;
    }

    displayClients.forEach(client => {
        const count = invoices.filter(i => {
            if (window.isDemoMode) return (i.clientName || 'TechVision s.r.o.') === client.name;
            return i.clientName === client.name && (i.accountantId === user?.uid || i.userId === user?.uid);
        }).length;
        const pin = client.pairingCode || 'PIN-999';

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition";
        tr.innerHTML = `
            <td class="p-3 pl-4 font-semibold text-slate-800 dark:text-slate-200">
                <div>${client.name}</div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400 font-normal">${client.ico ? 'IČO: ' + client.ico : (client.contactPerson ? client.contactPerson : '')}</div>
            </td>
            <td class="p-3 text-center">
                <button onclick="copyPairingCode('${pin}')" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-mono font-bold text-xs border border-emerald-500/30 transition">
                    <i data-lucide="copy" class="w-3.5 h-3.5"></i> <span>${pin}</span>
                </button>
            </td>
            <td class="p-3 text-center">
                <span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    ${count} ${count === 1 ? 'doklad' : (count >= 2 && count <= 4 ? 'doklady' : 'dokladů')}
                </span>
            </td>
            <td class="p-3 text-right pr-4 whitespace-nowrap">
                <div class="flex items-center justify-end gap-1.5">
                    <button onclick="openClientDetailModal('${client.id}')" class="px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition flex items-center gap-1">
                        <i data-lucide="info" class="w-3.5 h-3.5"></i> Detail
                    </button>
                    <button onclick="renameClient('${client.id}', '${encodeURIComponent(client.name)}')" class="px-2 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition flex items-center gap-1">
                        <i data-lucide="edit-2" class="w-3.5 h-3.5"></i> Přejmenovat
                    </button>
                    <button onclick="deleteClient('${client.id}', '${encodeURIComponent(client.name)}')" class="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
    if (window.lucide) window.lucide.createIcons();
}

export function openClientDetailModal(clientId) {
    selectedClientIdForModal = clientId;
    let client = null;
    if (window.isDemoMode) {
        const demoList = [
            { id: 'd1', name: 'TechVision s.r.o.', pairingCode: 'TEC-821', ico: '28475921', dic: 'CZ28475921', contactPerson: 'Martin Dvořák', phone: '+420 777 888 999', email: 'dvorak@techvision.cz', address: 'Evropská 11, 160 00 Praha 6', bankAccount: '230049281/2010', notes: 'Měsíční paušál 4000 Kč' },
            { id: 'd2', name: 'Kavárna Liberec s.r.o.', pairingCode: 'KAV-319', ico: '09384722', dic: 'CZ09384722', contactPerson: 'Petra Svobodová', phone: '+420 602 111 222', email: 'info@kavarnaliberec.cz', address: 'Náměstí Dr. E. Beneše 1, Liberec', bankAccount: '19482019/0300', notes: 'Čtvrtletní plátce DPH' },
            { id: 'd3', name: 'Jan Novák - Design', pairingCode: 'NOV-552', ico: '84920194', dic: '', contactPerson: 'Jan Novák', phone: '+420 724 333 444', email: 'jan@novakdesign.cz', address: 'Husova 14, Jablonec n. N.', bankAccount: '670100-22019284/6210', notes: 'Neplátce DPH' }
        ];
        client = demoList.find(c => c.id === clientId);
    } else {
        client = customClients.find(c => c.id === clientId);
    }
    if (!client) {
        showToast("Firma nebyla nalezena.", "warning");
        return;
    }

    const t = document.getElementById('client-detail-title');
    if (t) t.textContent = `Klientská karta: ${client.name}`;
    const p = document.getElementById('modal-client-pin');
    if (p) p.textContent = client.pairingCode || 'PIN-999';

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
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
}

export async function saveClientDetailChanges(e) {
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
        if (window.isDemoMode || selectedClientIdForModal.startsWith('d')) {
            showToast("V demo režimu byly údaje uloženy.", "success");
        } else {
            await updateDoc(doc(db, "clients", selectedClientIdForModal), updatedData);
            showToast(`Údaje klienta "${updatedData.name}" byly úspěšně uloženy!`, "success");
        }
        closeModal('client-info-modal');
        updateDynamicClients();
        renderClientsModalTable();
    } catch (err) {
        alert("Chyba při ukládání klienta: " + err.message);
    }
}

export async function renameClient(clientId, encodedOldName) {
    const oldName = decodeURIComponent(encodedOldName);
    const newName = prompt(`Přejmenovat firmu "${oldName}" na:`, oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;
    const cleanNew = newName.trim();
    const user = auth.currentUser || currentUser;
    try {
        if (clientId && !clientId.startsWith('d')) {
            await updateDoc(doc(db, "clients", clientId), { name: cleanNew });
        }
        const affectedInvoices = invoices.filter(inv => inv.clientName === oldName && (inv.accountantId === user?.uid || window.isDemoMode));
        for (const inv of affectedInvoices) {
            await updateDoc(doc(db, "invoices", inv.id), { clientName: cleanNew });
        }
        showToast(`Firma byla přejmenována na "${cleanNew}"`, "success");
    } catch (err) {
        showToast("Chyba při přejmenování firmy: " + err.message, "warning");
    }
}

export async function deleteClient(clientId, encodedName) {
    const name = decodeURIComponent(encodedName);
    const user = auth.currentUser || currentUser;
    const docCount = invoices.filter(i => i.clientName === name && (i.accountantId === user?.uid || window.isDemoMode)).length;
    let confirmMsg = `Opravdu chcete smazat firmu "${name}" ze seznamu?`;
    if (docCount > 0) confirmMsg = `POZOR: Firma "${name}" má v systému ${docCount} dokladů! Pokračovat ve smazání firmy?`;
    if (!confirm(confirmMsg)) return;
    try {
        if (clientId && !clientId.startsWith('d')) {
            await deleteDoc(doc(db, "clients", clientId));
        }
        customClients = customClients.filter(c => c.id !== clientId);
        showToast(`Firma "${name}" byla úspěšně odstraněna.`, "info");
        updateDynamicClients();
        renderClientsModalTable();
    } catch (err) {
        alert("Chyba při mazání firmy z databáze: " + err.message);
    }
}

async function addNewClient(name) {
    const clean = name.trim();
    if (!clean) return;
    const user = auth.currentUser || currentUser;
    const accountantId = user ? user.uid : 'demo';
    const newPin = generatePairingPin();

    try {
        await addDoc(collection(db, "clients"), {
            name: clean,
            pairingCode: newPin,
            accountantId: accountantId,
            userId: accountantId,
            createdAt: new Date().toISOString()
        });
        showToast(`Firma "${clean}" založena s párovacím PINem ${newPin}!`, "success");
    } catch (err) {
        console.error("Chyba při ukládání firmy do Firestore:", err);
        alert("CHYBA UKLÁDÁNÍ DO FIREBASE:\n" + err.message);
        updateDynamicClients();
        renderClientsModalTable();
    }
}

export async function addNewClientFromInput() {
    const input = document.getElementById('new-client-input');
    if (!input || !input.value.trim()) return;
    await addNewClient(input.value);
    input.value = '';
}

export async function addNewClientPrompt() {
    const newName = prompt("Zadejte název nové firmy nebo jméno klienta:");
    if (!newName || !newName.trim()) return;
    await addNewClient(newName);
}

// ================= EXPORT ISDOC PRO MONEY S3 & POHODU =================
export function downloadSingleISDOC(id) {
    const targetId = id || selectedInvoiceId;
    let inv = invoices.find(i => i.id === targetId);
    if (!inv) return showToast("Faktura nenalezena nebo není vybrána.", "warning");

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
    const filename = `ISDOC_${inv.clientName ? inv.clientName.replace(/[^a-zA-Z0-9]/g, '_') : 'firma'}_${inv.invoiceNumber || inv.vs || inv.id}.isdoc`;
    triggerDownload(xml, filename, 'application/xml;charset=utf-8');
    showToast(`ISDOC soubor "${filename}" byl úspěšně stažen!`, "success");
}

export function openExportIsdocModal() {
    updateDynamicClients();
    const accClientVal = document.getElementById('acc-client-select')?.value || 'all';
    const exportClientSelect = document.getElementById('export-isdoc-client');
    if (exportClientSelect) {
        exportClientSelect.value = accClientVal;
    }
    if (window.lucide) window.lucide.createIcons();
    openModal('export-isdoc-modal');
}

export function exportInvoices(format = 'isdoc') {
    openExportIsdocModal();
}

export function executeIsdocExport(e) {
    if (e) e.preventDefault();

    const rawClientFilter = document.getElementById('export-isdoc-client')?.value || 'all';
    const clientFilter = rawClientFilter.trim();
    const dateFrom = document.getElementById('export-isdoc-date-from')?.value || '';
    const dateTo = document.getElementById('export-isdoc-date-to')?.value || '';

    const fromNum = toDateNumber(dateFrom);
    const toNum = toDateNumber(dateTo);

    if (fromNum !== null && toNum !== null && fromNum > toNum) {
        return showToast("Datum 'Od' nemůže být pozdější než datum 'Do'.", "warning");
    }

    const user = auth.currentUser || currentUser;
    const knownClients = getAllClientNames().map(c => c.trim().toLowerCase());

    // 1. Vždy vybereme pouze zaúčtované doklady (status === 'approved') patřící účetní / jejím klientům
    let list = invoices.filter(inv => {
        if (inv.status !== 'approved') return false;
        if (window.isDemoMode || !user) return true;
        const invClient = (inv.clientName || '').trim().toLowerCase();
        return (
            inv.accountantId === user.uid ||
            inv.userId === user.uid ||
            !inv.accountantId ||
            (invClient && knownClients.includes(invClient))
        );
    });

    // 2. Filtrování podle firmy (pokud není vybráno 'all' / Všechny firmy)
    if (
        clientFilter &&
        clientFilter !== 'all' &&
        clientFilter.toLowerCase() !== 'všechny firmy' &&
        clientFilter.toLowerCase() !== 'všichni klienti'
    ) {
        const targetClient = clientFilter.toLowerCase();
        list = list.filter(inv => (inv.clientName || '').trim().toLowerCase() === targetClient);
    }

    // 3. Filtrování podle časového intervalu (bez problémů s časovými zónami a půlnocí)
    if (fromNum !== null || toNum !== null) {
        list = list.filter(inv => {
            // Primárně porovnáváme dateIssue a dateTax, případně createdAt
            const candidateNums = [inv.dateIssue, inv.dateTax, inv.createdAt]
                .map(toDateNumber)
                .filter(Boolean);

            if (candidateNums.length === 0) return true;

            return candidateNums.some(num => {
                if (fromNum !== null && num < fromNum) return false;
                if (toNum !== null && num > toNum) return false;
                return true;
            });
        });
    }

    if (list.length === 0) {
        return showToast("Pro zadané parametry nebyly nalezeny žádné zaúčtované faktury k exportu.", "warning");
    }

    closeModal('export-isdoc-modal');

    list.forEach((inv, idx) => {
        setTimeout(() => {
            triggerDownload(
                generateISDOCXml(inv),
                `ISDOC_${inv.clientName ? inv.clientName.replace(/[^a-zA-Z0-9]/g, '_') : 'firma'}_${inv.invoiceNumber || inv.vs || inv.id}.isdoc`,
                'application/xml;charset=utf-8'
            );
        }, idx * 250);
    });

    showToast(`Vygenerováno a staženo ${list.length} ISDOC souborů!`, "success");
}

// ================= EXPORT VŠECH HANDLERŮ NA WINDOW (PRO HTML) =================
Object.assign(window, {
    // UI & Téma
    openModal,
    closeModal,
    showToast,
    formatDateTime,
    closeProfileDropdown,
    toggleProfileDropdown,
    toggleTheme,

    // Auth & Profil
    setAuthMode,
    updateRoleTypeUI,
    handleAuthSubmit,
    handleForgotPassword,
    handleLogout,
    openAccountSettingsModal,
    saveAccountSettings,
    openChangePasswordModal,
    handleChangePassword,
    sendResetPasswordLink,
    continueAsDemo,

    // Skener & OpenAI
    triggerScan,
    startRescanForInvoice,
    rescanCurrentDocument,
    handleRescanCompleted,
    handleDemoInvoiceAdded,
    handleFileSelect,
    switchScanPage,
    updateScanPagesUI,
    processWithOpenAI,
    saveExtractedInvoice,
    calculateScanAmounts,
    focusAiField,
    toggleScanAiOverlay,
    toggleDetailAiOverlay,
    fetchAresData,
    verifyAresFromInput,

    // Přehledy, filtry & detail dokladu
    switchRole,
    renderClientInvoices,
    filterClientInvoices,
    renderAccountantInvoices,
    handleClientDatePresetChange,
    handleAccDatePresetChange,
    updateDynamicClients,
    openDetailModal,
    saveDetailChanges,
    clientSubmitInvoice,
    updateInvoiceStatus,
    deleteCurrentInvoice,
    deleteInvoice,
    calculateDetailAmounts,
    zoomDetailImg,
    rotateDetailImg,
    resetDetailImg,
    switchDetailPage,
    updateDetailPagesUI,
    openDetailImgFull,

    // Správa klientů & PINů
    copyPairingCode,
    copyModalPin,
    renderClientsModalTable,
    openClientDetailModal,
    saveClientDetailChanges,
    renameClient,
    deleteClient,
    addNewClientFromInput,
    addNewClientPrompt,

    // Export ISDOC
    downloadSingleISDOC,
    openExportIsdocModal,
    exportInvoices,
    executeIsdocExport
});

// ================= FIREBASE SYNCHRONIZACE & START =================
initTheme();
initAuthListener();

const invoicesQuery = query(collection(db, "invoices"), orderBy("createdAt", "desc"));
onSnapshot(invoicesQuery, (snapshot) => {
    invoices = [];
    snapshot.forEach((docSnap) => invoices.push({ id: docSnap.id, ...docSnap.data() }));
    updateDynamicClients();
    renderClientInvoices();
    renderAccountantInvoices();
}, (error) => {
    console.error("Chyba při čtení z Firestore:", error);
    showToast("Chyba synchronizace databáze: " + error.message, "warning");
});

const clientsQuery = query(collection(db, "clients"), orderBy("name", "asc"));
onSnapshot(clientsQuery, (snapshot) => {
    customClients = [];
    snapshot.forEach((docSnap) => customClients.push({ id: docSnap.id, ...docSnap.data() }));
    updateDynamicClients();
    renderClientsModalTable();
}, (err) => console.warn("Kolekce clients nebyla načtena z databáze:", err));

function initApp() {
    if (window.lucide) window.lucide.createIcons();
    renderClientInvoices();
    renderAccountantInvoices();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

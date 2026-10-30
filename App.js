import { db, auth } from './firebase.js';
import { collection, onSnapshot, doc, updateDoc, deleteDoc, setDoc, getDoc, query, orderBy, getDocs, where } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword, sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { openModal, closeModal, showToast, toggleTheme, toggleProfileDropdown, closeProfileDropdown, zoomDetailImg, rotateDetailImg, resetDetailImg, switchDetailPage, updateDetailPagesUI, openDetailImgFull } from './ui.js';
import { triggerScan, handleFileSelect, updateScanPagesUI, switchScanPage, processWithOpenAI, saveExtractedInvoice, calculateScanAmounts, calculateDetailAmounts } from './Scanner.js';
import { downloadSingleISDOC, exportInvoices } from './Isdoc.js';

window.currentUser = null;
window.currentUserData = null;
window.currentRole = 'client';
window.activeClientCompany = 'Moje Firma s.r.o.';
window.activeAccountantCompany = 'Účetní kancelář';
window.selectedInvoiceId = null;
window.selectedClientIdForModal = null;
window.invoices = [];
window.customClients = [];
window.currentClientFilter = 'all';
window.authMode = 'signin';
window.isDemoMode = false;
window.currentInvoicePages = [];
window.activeDetailPageIdx = 0;

const invoicesQuery = query(collection(db, "invoices"), orderBy("createdAt", "desc"));
onSnapshot(invoicesQuery, (snapshot) => {
    window.invoices = [];
    snapshot.forEach((docSnap) => window.invoices.push({ id: docSnap.id, ...docSnap.data() }));
    updateDynamicClients();
    renderClientInvoices();
    renderAccountantInvoices();
}, (error) => showToast("Chyba synchronizace databáze: " + error.message, "warning"));

const clientsQuery = query(collection(db, "clients"), orderBy("name", "asc"));
onSnapshot(clientsQuery, (snapshot) => {
    window.customClients = [];
    snapshot.forEach((docSnap) => window.customClients.push({ id: docSnap.id, ...docSnap.data() }));
    updateDynamicClients();
    renderClientsModalTable();
});

onAuthStateChanged(auth, async (user) => {
    window.currentUser = user;
    const landingPage = document.getElementById('landing-page');
    const appContainer = document.getElementById('app');
    
    if (user) {
        window.isDemoMode = false;
        if (landingPage) landingPage.classList.add('hidden');
        if (appContainer) appContainer.classList.remove('hidden');

        try {
            const userSnap = await getDoc(doc(db, "users", user.uid));
            if (userSnap.exists()) {
                window.currentUserData = userSnap.data();
                window.currentRole = window.currentUserData.role || 'client';
                if (window.currentUserData.company) {
                    if (window.currentRole === 'client') {
                        window.activeClientCompany = window.currentUserData.company;
                    } else {
                        window.activeAccountantCompany = window.currentUserData.company;
                    }
                }
            }
        } catch (e) {}

        if (window.currentRole === 'client') switchRole('client');
        else switchRole('accountant');
    } else {
        if (!window.isDemoMode && landingPage && appContainer) {
            landingPage.classList.remove('hidden');
            appContainer.classList.add('hidden');
        }
    }
    updateDynamicClients();
    renderClientsModalTable();
    renderClientInvoices();
    renderAccountantInvoices();
});

function formatDateTime(isoString) { /* Původní kód z formatDateTime */ }
function checkDateMatch(inv, preset, fromDate, toDate) { /* Původní kód z checkDateMatch */ }
function getAllClientNames() { /* Původní kód z getAllClientNames */ }
function updateDynamicClients() { /* Původní kód z updateDynamicClients */ }
function renderClientsModalTable() { /* Původní kód z renderClientsModalTable */ }
function renderClientInvoices(filterStatus = null) { /* Původní kód z renderClientInvoices */ }
function renderAccountantInvoices() { /* Původní kód z renderAccountantInvoices */ }
function switchRole(role) { /* Původní kód z switchRole */ }

// Binding všeho na window objekt pro zachování funkčnosti v HTML onclick handlerů
window.openModal = openModal;
window.closeModal = closeModal;
window.showToast = showToast;
window.toggleTheme = toggleTheme;
window.toggleProfileDropdown = toggleProfileDropdown;
window.closeProfileDropdown = closeProfileDropdown;
window.zoomDetailImg = zoomDetailImg;
window.rotateDetailImg = rotateDetailImg;
window.resetDetailImg = resetDetailImg;
window.switchDetailPage = switchDetailPage;
window.updateDetailPagesUI = updateDetailPagesUI;
window.openDetailImgFull = openDetailImgFull;

window.triggerScan = triggerScan;
window.handleFileSelect = handleFileSelect;
window.updateScanPagesUI = updateScanPagesUI;
window.switchScanPage = switchScanPage;
window.processWithOpenAI = processWithOpenAI;
window.saveExtractedInvoice = saveExtractedInvoice;
window.calculateScanAmounts = calculateScanAmounts;
window.calculateDetailAmounts = calculateDetailAmounts;

window.downloadSingleISDOC = downloadSingleISDOC;
window.exportInvoices = () => exportInvoices('isdoc', auth);

// Zbylé existující handler funkce z původního app.js jako window.handleAuthSubmit, window.handleLogout atd...
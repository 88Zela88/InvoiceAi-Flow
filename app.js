// Aktualizovaná verze app.js - Firebase Storage, Vícestránkový Scan, Fullscreen Křížek
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

// Globální stavy pro skenování a zobrazení vícestránkových dokladů
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

window.handleClientDatePresetChange = function() {
    const val = document.getElementById('client-date-preset')?.value;
    const customBox = document.getElementById('client-custom-dates');
    if (customBox) {
        if (val === 'custom') customBox.classList.remove('hidden');
        else customBox.classList.add('hidden');
    }
    renderClientInvoices();
};

window.handleAccDatePresetChange = function() {
    const val = document.getElementById('acc-date-preset')?.value;
    const customBox = document.getElementById('acc-custom-dates');
    if (customBox) {
        if (val === 'custom') customBox.classList.remove('hidden');
        else customBox.classList.add('hidden');
    }
    renderAccountantInvoices();
};

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

        if (currentRole === 'client') switchRole('client');
        else switchRole('accountant');

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

window.setAuthMode = function(mode) {
    authMode = mode;
    const landIn = document.getElementById('landing-tab-signin');
    const landUp = document.getElementById('landing-tab-signup');
    const landTitle = document.getElementById('landing-auth-title');
    const extraFields = document.getElementById('signup-extra-fields');
    const submitLabel = document.getElementById('auth-submit-label');
    const forgotBox = document.getElementById('forgot-password-box');

    if (mode === 'signin') {
        if (landIn) landIn.className = "flex-1 py-1.5 sm:py-2 rounded-lg text-xs font-bold transition bg-white text-slate-900 shadow-sm";
        if (landUp) landUp.className = "flex-1 py-1.5 sm:py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 transition";
        if (landTitle) landTitle.textContent = "Přihlášení do systému";
        if (extraFields) extraFields.classList.add('hidden');
        if (submitLabel) submitLabel.textContent = "Přihlásit se do systému";
        if (forgotBox) forgotBox.classList.remove('hidden');
    } else {
        if (landUp) landUp.className = "flex-1 py-1.5 sm:py-2 rounded-lg text-xs font-bold transition bg-white text-slate-900 shadow-sm";
        if (landIn) landIn.className = "flex-1 py-1.5 sm:py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 transition";
        if (landTitle) landTitle.textContent = "Vytvoření nového účtu";
        if (extraFields) extraFields.classList.remove('hidden');
        if (submitLabel) submitLabel.textContent = "Vytvořit nový účet";
        if (forgotBox) forgotBox.classList.add('hidden');
    }
};

window.updateRoleTypeUI = function(role) {
    const accBox = document.getElementById('accountant-company-box');
    const cliBox = document.getElementById('client-pairing-box');
    const labelAcc = document.getElementById('label-role-accountant');
    const labelCli = document.getElementById('label-role-client');

    if (role === 'accountant') {
        if (accBox) accBox.classList.remove('hidden');
        if (cliBox) cliBox.classList.add('hidden');
        if (labelAcc) { labelAcc.classList.add('border-emerald-500', 'bg-emerald-500/10'); labelAcc.classList.remove('border-slate-800'); }
        if (labelCli) { labelCli.classList.remove('border-emerald-500', 'bg-emerald-500/10'); labelCli.classList.add('border-slate-800'); }
    } else {
        if (accBox) accBox.classList.add('hidden');
        if (cliBox) cliBox.classList.remove('hidden');
        if (labelCli) { labelCli.classList.add('border-emerald-500', 'bg-emerald-500/10'); labelCli.classList.remove('border-slate-800'); }
        if (labelAcc) { labelAcc.classList.remove('border-emerald-500', 'bg-emerald-500/10'); labelAcc.classList.add('border-slate-800'); }
    }
};

window.continueAsDemo = function() {
    window.isDemoMode = true;
    currentUser = null;
    currentUserData = null;
    currentRole = 'client';
    activeClientCompany = 'TechVision s.r.o.';
    activeAccountantCompany = 'Účetní kancelář ProFit s.r.o.';

    const landingPage = document.getElementById('landing-page');
    const appContainer = document.getElementById('app');
    const demoSwitcher = document.getElementById('demo-switcher-container');

    if (landingPage) landingPage.classList.add('hidden');
    if (appContainer) appContainer.classList.remove('hidden');
    if (demoSwitcher) demoSwitcher.classList.remove('hidden');

    document.getElementById('current-client-badge').textContent = `Firma: TechVision s.r.o.`;
    document.getElementById('user-display-email').textContent = 'Demo Návštěvník';
    document.getElementById('user-display-role').textContent = 'Zkušební Demo';

    showToast("Vstoupili jste do zkušebního demo režimu.", "info");
    lucide.createIcons();
    updateDynamicClients();
    renderClientsModalTable();
    renderClientInvoices();
    renderAccountantInvoices();
};

window.handleAuthSubmit = async function(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const roleEl = document.querySelector('input[name="auth-role"]:checked');
    const role = roleEl ? roleEl.value : 'accountant';

    if (!email || !password) return;

    try {
        if (authMode === 'signup') {
            let finalCompany = '';
            let linkedAccountantId = '';

            if (role === 'accountant') {
                finalCompany = document.getElementById('auth-accountant-company')?.value?.trim() || 'Moje Účetní Kancelář';
            } else {
                const pinInput = document.getElementById('auth-pairing-code')?.value?.trim().toUpperCase();
                const clientNameInput = document.getElementById('auth-client-company')?.value?.trim();

                if (pinInput) {
                    const qPin = query(collection(db, "clients"), where("pairingCode", "==", pinInput));
                    const pinSnap = await getDocs(qPin);

                    if (!pinSnap.empty) {
                        const foundClient = pinSnap.docs[0].data();
                        finalCompany = foundClient.name;
                        linkedAccountantId = foundClient.accountantId || '';
                        showToast(`Účet byl úspěšně spárován s firmou ${finalCompany}!`, "success");
                    } else {
                        alert(`Zadaný párovací kód "${pinInput}" nebyl nalezen. Zkontrolujte prosím kód od vaší účetní kanceláře.`);
                        return;
                    }
                } else {
                    finalCompany = clientNameInput || 'Moje Firma s.r.o.';
                }
            }

            const cred = await createUserWithEmailAndPassword(auth, email, password);
            await setDoc(doc(db, "users", cred.user.uid), {
                email: email,
                role: role,
                company: finalCompany,
                accountantId: linkedAccountantId,
                createdAt: new Date().toISOString()
            });

            if (role === 'accountant') {
                await addNewClient(finalCompany);
            }

            showToast("Registrace proběhla úspěšně!", "success");
        } else {
            await signInWithEmailAndPassword(auth, email, password);
        }
    } catch (err) {
        console.error("Chyba při přihlašování/registraci:", err);
        let msg = err.message;
        if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
            msg = "Nesprávný e-mail nebo heslo.";
        } else if (err.code === 'auth/email-already-in-use') {
            msg = "Tento e-mail je již v systému zaregistrován. Zvolte Přihlásit se.";
        } else if (err.code === 'auth/weak-password') {
            msg = "Heslo musí mít alespoň 6 znaků.";
        }
        alert("Chyba ověření: " + msg);
    }
};

window.handleForgotPassword = async function() {
    let email = document.getElementById('auth-email')?.value?.trim();
    if (!email) {
        email = prompt("Zadejte svůj e-mail pro zaslání odkazu pro obnovení hesla:");
    }
    if (!email) return;

    try {
        await sendPasswordResetEmail(auth, email);
        alert(`Odkaz pro obnovení hesla byl odeslán na adresu ${email}. Zkontrolujte si prosím svou e-mailovou schránku.`);
        showToast("E-mail pro obnovu hesla byl odeslán!", "success");
    } catch (err) {
        let msg = err.message;
        if (err.code === 'auth/user-not-found') msg = "Účet s tímto e-mailem nebyl nalezen.";
        alert("Chyba při odesílání: " + msg);
    }
};

window.handleLogout = async function() {
    try {
        await signOut(auth);
        currentUser = null;
        currentUserData = null;
        window.isDemoMode = false;
        currentRole = 'client';
        activeClientCompany = 'TechVision s.r.o.';
        
        if (document.getElementById('auth-email')) document.getElementById('auth-email').value = '';
        if (document.getElementById('auth-password')) document.getElementById('auth-password').value = '';
        if (document.getElementById('auth-accountant-company')) document.getElementById('auth-accountant-company').value = '';
        if (document.getElementById('auth-pairing-code')) document.getElementById('auth-pairing-code').value = '';
        if (document.getElementById('auth-client-company')) document.getElementById('auth-client-company').value = '';

        closeProfileDropdown();

        const landingPage = document.getElementById('landing-page');
        const appContainer = document.getElementById('app');
        if (landingPage) landingPage.classList.remove('hidden');
        if (appContainer) appContainer.classList.add('hidden');

        showToast("Byl jste úspěšně odhlášen.", "info");
        lucide.createIcons();
    } catch (err) {
        console.error("Chyba při odhlašování:", err);
    }
};

window.toggleProfileDropdown = function() {
    const menu = document.getElementById('profile-dropdown-menu');
    const chevron = document.getElementById('profile-dropdown-chevron');
    if (menu) {
        const isHidden = menu.classList.contains('hidden');
        if (isHidden) {
            menu.classList.remove('hidden');
            if (chevron) chevron.classList.add('rotate-180');
        } else {
            closeProfileDropdown();
        }
    }
};

function closeProfileDropdown() {
    const menu = document.getElementById('profile-dropdown-menu');
    const chevron = document.getElementById('profile-dropdown-chevron');
    if (menu) menu.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
}

document.addEventListener('click', (e) => {
    const container = document.getElementById('auth-logged-in');
    if (container && !container.contains(e.target)) {
        closeProfileDropdown();
    }
});

window.toggleTheme = function() {
    const html = document.documentElement;
    const isDark = html.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeUI(isDark);
};

function updateThemeUI(isDark) {
    const icon = document.getElementById('theme-icon');
    const label = document.getElementById('theme-label');
    const badge = document.getElementById('theme-badge');
    if (icon && label && badge) {
        if (isDark) {
            label.textContent = "Světlý režim";
            badge.textContent = "Aktivní";
            badge.className = "text-[10px] uppercase font-bold text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded";
        } else {
            label.textContent = "Tmavý režim";
            badge.textContent = "Vypnuto";
            badge.className = "text-[10px] uppercase font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded";
        }
    }
    if (window.lucide) window.lucide.createIcons();
}

if (localStorage.getItem('theme') === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
    updateThemeUI(true);
} else {
    document.documentElement.classList.remove('dark');
    updateThemeUI(false);
}

window.openAccountSettingsModal = function() {
    closeProfileDropdown();
    const user = auth.currentUser;
    document.getElementById('settings-email').value = user ? user.email : 'demo@email.cz';
    document.getElementById('settings-company').value = currentRole === 'accountant' ? activeAccountantCompany : activeClientCompany;
    document.getElementById('settings-company-label').textContent = currentRole === 'accountant' ? 'Název účetní kanceláře' : 'Název vaší firmy';
    openModal('account-settings-modal');
};

window.saveAccountSettings = async function(e) {
    e.preventDefault();
    const newName = document.getElementById('settings-company').value.trim();
    if (!newName) return;

    const user = auth.currentUser;
    if (user && !window.isDemoMode) {
        try {
            await updateDoc(doc(db, "users", user.uid), { company: newName });
            if (currentRole === 'accountant') {
                activeAccountantCompany = newName;
                document.getElementById('acc-agency-badge').textContent = `Účetní kancelář: ${newName}`;
            } else {
                activeClientCompany = newName;
                document.getElementById('current-client-badge').textContent = `Firma: ${newName}`;
            }
            document.getElementById('user-display-role').textContent = currentRole === 'accountant' ? newName : `Klient (${newName})`;
            document.getElementById('menu-user-company').textContent = newName;
            showToast("Nastavení účtu bylo úspěšně uloženo!", "success");
            closeModal('account-settings-modal');
        } catch (err) {
            alert("Chyba při ukládání: " + err.message);
        }
    } else {
        showToast("V demo režimu bylo nastavení změněno lokálně.", "info");
        closeModal('account-settings-modal');
    }
};

window.openChangePasswordModal = function() {
    closeProfileDropdown();
    document.getElementById('current-password').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('confirm-new-password').value = '';
    openModal('change-password-modal');
};

window.handleChangePassword = async function(e) {
    e.preventDefault();
    const currentPass = document.getElementById('current-password').value;
    const p1 = document.getElementById('new-password').value;
    const p2 = document.getElementById('confirm-new-password').value;

    if (p1 !== p2) {
        alert("Nová hesla se neshodují! Zadejte obě nová hesla stejně.");
        return;
    }

    const user = auth.currentUser;
    if (!user || !user.email) {
        alert("Pro změnu hesla musíte být přihlášeni.");
        return;
    }

    try {
        const credential = EmailAuthProvider.credential(user.email, currentPass);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, p1);
        showToast("Vaše heslo bylo úspěšně změněno!", "success");
        closeModal('change-password-modal');
    } catch (err) {
        if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
            alert("Zadané stávající heslo není správné. Zkontrolujte prosím své současné heslo.");
        } else if (err.code === 'auth/weak-password') {
            alert("Nové heslo musí mít alespoň 6 znaků.");
        } else {
            alert("Chyba při změně hesla: " + err.message);
        }
    }
};

window.sendResetPasswordLink = async function() {
    const user = auth.currentUser;
    const email = user ? user.email : prompt("Zadejte svůj e-mail pro zaslání odkazu na reset hesla:");
    if (!email) return;

    try {
        await sendPasswordResetEmail(auth, email);
        showToast(`Odkaz pro změnu hesla byl odeslán na ${email}!`, "success");
        closeModal('change-password-modal');
    } catch (err) {
        alert("Chyba při odesílání e-mailu: " + err.message);
    }
};

let customClients = [];

const clientsQuery = query(collection(db, "clients"), orderBy("name", "asc"));
onSnapshot(clientsQuery, (snapshot) => {
    customClients = [];
    snapshot.forEach((docSnap) => {
        customClients.push({ id: docSnap.id, ...docSnap.data() });
    });
    updateDynamicClients();
    renderClientsModalTable();
}, (err) => {
    console.warn("Kolekce clients nebyla načtena z databáze:", err);
});

function generatePairingPin() {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const numbers = "23456789";
    let pin = "";
    for (let i = 0; i < 3; i++) pin += letters.charAt(Math.floor(Math.random() * letters.length));
    pin += "-";
    for (let i = 0; i < 3; i++) pin += numbers.charAt(Math.floor(Math.random() * numbers.length));
    return pin;
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

function updateDynamicClients() {
    const clientSelect = document.getElementById('field-client-name');
    const accSelect = document.getElementById('acc-client-select');
    if (!clientSelect || !accSelect) return;

    const allClients = getAllClientNames();
    const currentSelected = clientSelect.value;
    const currentAccSelected = accSelect.value;

    clientSelect.innerHTML = '';
    allClients.forEach(name => clientSelect.add(new Option(name, name)));
    if (currentSelected && allClients.includes(currentSelected)) clientSelect.value = currentSelected;

    accSelect.innerHTML = '<option value="all">Všichni klienti</option>';
    allClients.forEach(name => accSelect.add(new Option(name, name)));
    if (currentAccSelected && (currentAccSelected === 'all' || allClients.includes(currentAccSelected))) {
        accSelect.value = currentAccSelected;
    }
}

function renderClientsModalTable() {
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
        tr.className = "hover:bg-slate-800/50 transition";
        tr.innerHTML = `
            <td class="p-3 pl-4 font-semibold text-slate-200">
                <div>${client.name}</div>
                <div class="text-[11px] text-slate-400 font-normal">${client.ico ? 'IČO: ' + client.ico : (client.contactPerson ? client.contactPerson : '')}</div>
            </td>
            <td class="p-3 text-center">
                <button onclick="copyPairingCode('${pin}')" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-mono font-bold text-xs border border-emerald-500/30 transition">
                    <i data-lucide="copy" class="w-3.5 h-3.5"></i> <span>${pin}</span>
                </button>
            </td>
            <td class="p-3 text-center">
                <span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300">
                    ${count} ${count === 1 ? 'doklad' : (count >= 2 && count <= 4 ? 'doklady' : 'dokladů')}
                </span>
            </td>
            <td class="p-3 text-right pr-4 whitespace-nowrap">
                <div class="flex items-center justify-end gap-1.5">
                    <button onclick="openClientDetailModal('${client.id}')" class="px-2.5 py-1 text-xs font-semibold text-emerald-400 hover:bg-slate-800 rounded-lg transition flex items-center gap-1">
                        <i data-lucide="info" class="w-3.5 h-3.5"></i> Detail
                    </button>
                    <button onclick="renameClient('${client.id}', '${encodeURIComponent(client.name)}')" class="px-2 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-lg transition flex items-center gap-1">
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

window.openClientDetailModal = function(clientId) {
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

    document.getElementById('client-detail-title').textContent = `Klientská karta: ${client.name}`;
    document.getElementById('modal-client-pin').textContent = client.pairingCode || 'PIN-999';
    document.getElementById('modal-client-name').value = client.name || '';
    document.getElementById('modal-client-contact').value = client.contactPerson || '';
    document.getElementById('modal-client-phone').value = client.phone || '';
    document.getElementById('modal-client-email').value = client.email || '';
    document.getElementById('modal-client-ico').value = client.ico || '';
    document.getElementById('modal-client-dic').value = client.dic || '';
    document.getElementById('modal-client-bank').value = client.bankAccount || '';
    document.getElementById('modal-client-address').value = client.address || '';
    document.getElementById('modal-client-notes').value = client.notes || '';

    openModal('client-info-modal');
};

// Nová funkce pro generování striktně validního formátu UUID
function generateValidUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
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
    const dic = inv.dic || '';
    const vs = inv.vs || docId.replace(/\D/g, '') || '0';
    const bankAccount = inv.accountNumber || '';
    const paymentMethod = inv.paymentMethod || 'Převodem';
    
    // Vygenerujeme validní ISDOC UUID
    const validUuid = generateValidUUID();

    let paymentCode = paymentMethod === 'Hotově' ? '10' : paymentMethod === 'Kartou' ? '48' : paymentMethod === 'Zápočtem' ? '97' : '31';

    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.1">
  <DocumentType>1</DocumentType>
  <ID>${escapeXml(docId)}</ID>
  <UUID>${validUuid}</UUID>
  <IssuingSystem>ČtiDoklad</IssuingSystem>
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

function downloadSingleISDOC(id) {
    const targetId = id || selectedInvoiceId;
    let inv = invoices.find(i => i.id === targetId);
    if (!inv) return showToast("Faktura nenalezena nebo není vybrána.", "warning");

    if (selectedInvoiceId === targetId) {
        inv = {
            ...inv,
            clientName: document.getElementById('detail-client-select')?.value || inv.clientName,
            vendor: document.getElementById('detail-vendor')?.value?.trim() || inv.vendor,
            ico: document.getElementById('detail-ico')?.value?.trim() || inv.ico,
            invoiceNumber: document.getElementById('detail-invoice-num')?.value?.trim() || inv.invoiceNumber,
            vs: document.getElementById('detail-vs')?.value?.trim() || inv.vs,
            type: document.getElementById('detail-type')?.value || inv.type,
            paymentMethod: document.getElementById('detail-payment-method')?.value || inv.paymentMethod,
            dateIssue: document.getElementById('detail-due-issue')?.value || inv.dateIssue,
            dateTax: document.getElementById('detail-date-tax')?.value || inv.dateTax,
            dateDue: document.getElementById('detail-due')?.value || inv.dateDue,
            baseAmount: parseFloat(document.getElementById('detail-base-amount')?.value) || inv.baseAmount,
            vatRate: document.getElementById('detail-vat')?.value || inv.vatRate,
            vatAmount: parseFloat(document.getElementById('detail-vat-amount')?.value) || inv.vatAmount,
            amount: parseFloat(document.getElementById('detail-amount')?.value) || inv.amount,
            accountNumber: document.getElementById('detail-account')?.value?.trim() || inv.accountNumber,
            note: document.getElementById('detail-comment-note')?.value?.trim() || inv.note
        };
    }

    const xml = generateISDOCXml(inv);
    const filename = `ISDOC_${inv.clientName ? inv.clientName.replace(/[^a-zA-Z0-9]/g, '_') : 'firma'}_${inv.invoiceNumber || inv.vs || inv.id}.isdoc`;
    triggerDownload(xml, filename, 'application/xml;charset=utf-8');
}

function exportInvoices(format) {
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

// ================= KOMPLETNÍ EXPORTY DO PROHLÍŽEČE =================
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
window.updateDetailPagesUI = updateDetailPagesUI;
window.renderClientInvoices = renderClientInvoices;
window.renderAccountantInvoices = renderAccountantInvoices;
window.filterClientInvoices = filterClientInvoices;
window.calculateScanAmounts = calculateScanAmounts;
window.calculateDetailAmounts = calculateDetailAmounts;
window.handleClientDatePresetChange = handleClientDatePresetChange;
window.handleAccDatePresetChange = handleAccDatePresetChange;
window.downloadSingleISDOC = downloadSingleISDOC;
window.exportInvoices = exportInvoices;

// Inicializace UI po načtení stránky
window.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) window.lucide.createIcons();
    renderClientInvoices();
    renderAccountantInvoices();
});
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc, setDoc, getDoc, query, orderBy, getDocs, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword, sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";

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

// Stav pro vícestránkové skenování
let scannedPages = [];
let activeScanPageIdx = 0;

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
    if (inv.createdAt) {
        d = new Date(inv.createdAt);
    } else if (inv.dateIssue) {
        d = new Date(inv.dateIssue);
    }
    if (!d || isNaN(d.getTime())) return true;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (preset === 'today') {
        return dDate.getTime() === startOfToday.getTime();
    } else if (preset === 'week') {
        const sevenDaysAgo = new Date(startOfToday.getTime() - (7 * 24 * 60 * 60 * 1000));
        return dDate >= sevenDaysAgo && dDate <= now;
    } else if (preset === 'this_month') {
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    } else if (preset === 'last_month') {
        const lastMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
        const lastMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
        return d.getFullYear() === lastMonthYear && d.getMonth() === lastMonth;
    } else if (preset === 'custom') {
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
        if (labelAcc) { labelAcc.classList.add('border-blue-500', 'bg-blue-50/40'); labelAcc.classList.remove('border-slate-200'); }
        if (labelCli) { labelCli.classList.remove('border-blue-500', 'bg-blue-50/40'); labelCli.classList.add('border-slate-200'); }
    } else {
        if (accBox) accBox.classList.add('hidden');
        if (cliBox) cliBox.classList.remove('hidden');
        if (labelCli) { labelCli.classList.add('border-blue-500', 'bg-blue-50/40'); labelCli.classList.remove('border-slate-200'); }
        if (labelAcc) { labelAcc.classList.remove('border-blue-500', 'bg-blue-50/40'); labelAcc.classList.add('border-slate-200'); }
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
        if (err.code === 'auth/user-not-found') {
            msg = "Účet s tímto e-mailem nebyl nalezen.";
        }
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
    lucide.createIcons();
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
    updateDynamicClients();
    renderClientsModalTable();
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
    allClients.forEach(name => {
        clientSelect.add(new Option(name, name));
    });
    if (currentSelected && allClients.includes(currentSelected)) {
        clientSelect.value = currentSelected;
    }

    accSelect.innerHTML = '<option value="all">Všichni klienti</option>';
    allClients.forEach(name => {
        accSelect.add(new Option(name, name));
    });
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
        tr.className = "hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition";
        tr.innerHTML = `
            <td class="p-3 pl-4 font-semibold text-slate-800 dark:text-slate-100">
                <div>${client.name}</div>
                <div class="text-[11px] text-slate-400 font-normal">${client.ico ? 'IČO: ' + client.ico : (client.contactPerson ? client.contactPerson : '')}</div>
            </td>
            <td class="p-3 text-center">
                <button onclick="copyPairingCode('${pin}')" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 font-mono font-bold text-xs border border-indigo-200 dark:border-indigo-800 transition" title="Klikněte pro zkopírování PINu pro klienta">
                    <i data-lucide="copy" class="w-3.5 h-3.5"></i>
                    <span>${pin}</span>
                </button>
            </td>
            <td class="p-3 text-center">
                <span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    ${count} ${count === 1 ? 'doklad' : (count >= 2 && count <= 4 ? 'doklady' : 'dokladů')}
                </span>
            </td>
            <td class="p-3 text-right pr-4 whitespace-nowrap">
                <div class="flex items-center justify-end gap-1.5">
                    <button onclick="openClientDetailModal('${client.id}')" class="px-2.5 py-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-800 rounded-lg transition flex items-center gap-1" title="Zobrazit a upravit údaje klienta">
                        <i data-lucide="info" class="w-3.5 h-3.5"></i> Detail
                    </button>
                    <button onclick="renameClient('${client.id}', '${encodeURIComponent(client.name)}')" class="px-2 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition flex items-center gap-1">
                        <i data-lucide="edit-2" class="w-3.5 h-3.5"></i> Přejmenovat
                    </button>
                    <button onclick="deleteClient('${client.id}', '${encodeURIComponent(client.name)}')" class="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition" title="Smazat firmu">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
    lucide.createIcons();
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

window.copyModalPin = function() {
    const pin = document.getElementById('modal-client-pin').textContent;
    copyPairingCode(pin);
};

window.saveClientDetailChanges = async function(e) {
    e.preventDefault();
    if (!selectedClientIdForModal) return;

    const updatedData = {
        name: document.getElementById('modal-client-name').value.trim(),
        contactPerson: document.getElementById('modal-client-contact').value.trim(),
        phone: document.getElementById('modal-client-phone').value.trim(),
        email: document.getElementById('modal-client-email').value.trim(),
        ico: document.getElementById('modal-client-ico').value.trim(),
        dic: document.getElementById('modal-client-dic').value.trim(),
        bankAccount: document.getElementById('modal-client-bank').value.trim(),
        address: document.getElementById('modal-client-address').value.trim(),
        notes: document.getElementById('modal-client-notes').value.trim()
    };

    try {
        if (window.isDemoMode || selectedClientIdForModal.startsWith('d')) {
            showToast("V demo režimu byly údaje uloženy.", "success");
        } else {
            const docRef = doc(db, "clients", selectedClientIdForModal);
            await updateDoc(docRef, updatedData);
            showToast(`Údaje klienta "${updatedData.name}" byly úspěšně uloženy!`, "success");
        }
        closeModal('client-info-modal');
        updateDynamicClients();
        renderClientsModalTable();
    } catch (err) {
        console.error("Chyba při ukládání klienta:", err);
        alert("Chyba při ukládání klienta: " + err.message);
    }
};

window.copyPairingCode = function(code) {
    navigator.clipboard.writeText(code).then(() => {
        showToast(`Párovací PIN "${code}" byl zkopírován do schránky! Předejte ho klientovi.`, "success");
    }).catch(() => {
        prompt("Zkopírujte si párovací PIN pro klienta:", code);
    });
};

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
        alert("CHYBA UKLÁDÁNÍ DO FIREBASE:\n" + err.message + "\nZkontrolujte pravidla (Rules) v konzoli Firestore!");
        updateDynamicClients();
        renderClientsModalTable();
    }
}

window.addNewClientPrompt = async function() {
    const newName = prompt("Zadejte název nové firmy nebo jméno klienta:");
    if (!newName || !newName.trim()) return;
    await addNewClient(newName);
};

window.addNewClientFromInput = async function() {
    const input = document.getElementById('new-client-input');
    if (!input || !input.value.trim()) return;
    await addNewClient(input.value);
    input.value = '';
};

window.renameClient = async function(clientId, encodedOldName) {
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
        console.error("Chyba při přejmenování:", err);
        showToast("Chyba při přejmenování firmy: " + err.message, "warning");
    }
};

window.deleteClient = async function(clientId, encodedName) {
    const name = decodeURIComponent(encodedName);
    const user = auth.currentUser || currentUser;
    const docCount = invoices.filter(i => i.clientName === name && (i.accountantId === user?.uid || window.isDemoMode)).length;

    let confirmMsg = `Opravdu chcete smazat firmu "${name}" ze seznamu?`;
    if (docCount > 0) {
        confirmMsg = `POZOR: Firma "${name}" má v systému ${docCount} dokladů! Pokračovat ve smazání firmy?`;
    }

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
        console.error("Chyba při mazání firmy:", err);
        alert("Chyba při mazání firmy z databáze: " + err.message);
    }
};

window.deleteInvoice = async function(id) {
    if (!id) return;
    const inv = invoices.find(i => i.id === id);
    const vendorName = inv ? inv.vendor : 'tento doklad';

    if (!confirm(`Opravdu chcete nenávratně smazat doklad od dodavatele "${vendorName}"?`)) {
        return;
    }

    try {
        await deleteDoc(doc(db, "invoices", id));
        closeModal('detail-modal');
        showToast("Doklad byl úspěšně smazán z databáze.", "info");
    } catch (err) {
        console.error("Chyba při mazání dokladu z Firestore:", err);
        showToast("Chyba při mazání dokladu: " + err.message, "warning");
    }
};

function switchRole(role) {
    currentRole = role;
    const clientView = document.getElementById('client-view');
    const accountantView = document.getElementById('accountant-view');
    const btnClient = document.getElementById('role-btn-client');
    const btnAcc = document.getElementById('role-btn-accountant');

    if (role === 'client') {
        clientView.classList.remove('hidden');
        accountantView.classList.add('hidden');
        if (btnClient) btnClient.className = "px-2.5 py-1 rounded-lg text-xs font-semibold transition bg-blue-600 text-white";
        if (btnAcc) btnAcc.className = "px-2.5 py-1 rounded-lg text-xs font-semibold transition text-slate-400 hover:text-white";
        renderClientInvoices();
    } else {
        clientView.classList.add('hidden');
        accountantView.classList.remove('hidden');
        if (btnAcc) btnAcc.className = "px-2.5 py-1 rounded-lg text-xs font-semibold transition bg-blue-600 text-white";
        if (btnClient) btnClient.className = "px-2.5 py-1 rounded-lg text-xs font-semibold transition text-slate-400 hover:text-white";
        renderAccountantInvoices();
    }
}

function renderClientInvoices(filterStatus = null) {
    if (filterStatus !== null) {
        currentClientFilter = filterStatus;
    }
    const tbody = document.getElementById('client-invoice-table-body');
    const searchQuery = document.getElementById('client-search')?.value.toLowerCase() || '';
    const datePreset = document.getElementById('client-date-preset')?.value || 'all';
    const dateFrom = document.getElementById('client-date-from')?.value || '';
    const dateTo = document.getElementById('client-date-to')?.value || '';
    tbody.innerHTML = '';

    const user = auth.currentUser || currentUser;
    let filtered = [];

    if (window.isDemoMode) {
        filtered = invoices.filter(inv => !inv.userId || inv.isDemo || inv.clientName === 'TechVision s.r.o.');
    } else if (user && currentRole === 'client') {
        filtered = invoices.filter(inv => (inv.userId === user.uid) || (inv.clientName === activeClientCompany && !inv.isDemo));
    } else if (user && currentRole === 'accountant') {
        filtered = invoices.filter(inv => (inv.accountantId === user.uid || inv.userId === user.uid));
    }

    if (currentClientFilter === 'pending') filtered = filtered.filter(inv => inv.status === 'pending');
    if (currentClientFilter === 'approved') filtered = filtered.filter(inv => inv.status === 'approved');
    if (currentClientFilter === 'action_needed') filtered = filtered.filter(inv => inv.status === 'action_needed' || inv.status === 'rejected');

    filtered = filtered.filter(inv => checkDateMatch(inv, datePreset, dateFrom, dateTo));

    if (searchQuery) {
        filtered = filtered.filter(inv => 
            (inv.vendor && inv.vendor.toLowerCase().includes(searchQuery)) ||
            (inv.amount && inv.amount.toString().includes(searchQuery)) ||
            (inv.vs && inv.vs.includes(searchQuery)) ||
            (inv.invoiceNumber && inv.invoiceNumber.toLowerCase().includes(searchQuery))
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="p-8 text-center text-slate-400 text-xs">
                    Zatím nemáte žádné nahrané doklady odpovídající výběru.
                </td>
            </tr>
        `;
    } else {
        filtered.forEach(inv => {
            let statusBadge = '';
            if (inv.status === 'pending') {
                statusBadge = `<span class="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">Čeká na schválení</span>`;
            } else if (inv.status === 'approved') {
                statusBadge = `<span class="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">Zaúčtováno</span>`;
            } else {
                statusBadge = `<span class="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">K doplnění</span>`;
            }

            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition";
            tr.innerHTML = `
                <td class="p-3 pl-4">
                    <div class="font-bold text-slate-900 dark:text-white">${inv.vendor || '-'}</div>
                    <div class="text-xs text-slate-500 font-mono flex items-center gap-1.5 flex-wrap">
                        <span>${inv.invoiceNumber ? 'Číslo: ' + inv.invoiceNumber : (inv.vs ? 'VS: ' + inv.vs : '')}</span>
                    </div>
                </td>
                <td class="p-3 text-xs text-slate-600 dark:text-slate-400">
                    <div>Vystaveno: ${inv.dateIssue || '-'}</div>
                    <div class="text-slate-400 dark:text-slate-500">Splatnost: ${inv.dateDue || '-'}</div>
                    <div class="text-[11px] text-blue-600 dark:text-blue-400 font-medium mt-0.5">Nahráno: ${formatDateTime(inv.createdAt)}</div>
                </td>
                <td class="p-3 text-xs text-slate-600 dark:text-slate-300">
                    <div class="font-medium">${inv.type || 'Přijatá faktura'}</div>
                    <span class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-300 font-semibold">${inv.paymentMethod || 'Převodem'}</span>
                </td>
                <td class="p-3 font-bold text-slate-900 dark:text-white">${Number(inv.amount || 0).toLocaleString('cs-CZ')} Kč</td>
                <td class="p-3">${statusBadge}</td>
                <td class="p-3 text-right pr-4 whitespace-nowrap">
                    <div class="flex items-center justify-end gap-1">
                        <button onclick="openDetailModal('${inv.id}')" title="Detail dokladu" class="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800 transition">
                            <i data-lucide="eye" class="w-4 h-4"></i>
                        </button>
                        <button onclick="deleteInvoice('${inv.id}')" title="Smazat doklad" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    lucide.createIcons();
    updateClientStats(filtered);
}

function filterClientInvoices(status) {
    document.querySelectorAll('.client-filter-btn').forEach(btn => {
        btn.className = "client-filter-btn px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 whitespace-nowrap";
    });
    const activeBtn = document.getElementById(`filter-btn-${status}`);
    if (activeBtn) {
        activeBtn.className = "client-filter-btn active px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white whitespace-nowrap";
    }
    renderClientInvoices(status);
}

function updateClientStats(filteredList) {
    const list = filteredList || [];
    const pending = list.filter(i => i.status === 'pending').length;
    const approved = list.filter(i => i.status === 'approved').length;
    const rejected = list.filter(i => i.status === 'action_needed' || i.status === 'rejected').length;
    const totalSum = list.reduce((sum, i) => sum + Number(i.amount || 0), 0);

    document.getElementById('stat-client-total').textContent = `${totalSum.toLocaleString('cs-CZ')} Kč`;
    document.getElementById('stat-client-count').textContent = list.length;
    document.getElementById('stat-client-pending').textContent = pending;
    document.getElementById('stat-client-approved').textContent = approved;
    document.getElementById('stat-client-rejected').textContent = rejected;
}

function renderAccountantInvoices() {
    const tbody = document.getElementById('accountant-invoice-table-body');
    const clientFilter = document.getElementById('acc-client-select')?.value || 'all';
    const statusFilter = document.getElementById('acc-status-select')?.value || 'all';
    const datePreset = document.getElementById('acc-date-preset')?.value || 'all';
    const dateFrom = document.getElementById('acc-date-from')?.value || '';
    const dateTo = document.getElementById('acc-date-to')?.value || '';
    tbody.innerHTML = '';

    const user = auth.currentUser || currentUser;
    let filtered = [];

    if (window.isDemoMode) {
        filtered = [...invoices];
    } else if (user && currentRole === 'accountant') {
        filtered = invoices.filter(inv => inv.accountantId === user.uid || inv.userId === user.uid);
    }

    if (clientFilter !== 'all') {
        filtered = filtered.filter(i => i.clientName === clientFilter);
    }
    if (statusFilter !== 'all') {
        filtered = filtered.filter(i => statusFilter === 'action_needed' ? (i.status === 'action_needed' || i.status === 'rejected') : i.status === statusFilter);
    }

    filtered = filtered.filter(inv => checkDateMatch(inv, datePreset, dateFrom, dateTo));

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="p-8 text-center text-slate-400 text-xs">
                    Žádné doklady neodpovídají vybraným filtrům.
                </td>
            </tr>
        `;
    } else {
        filtered.forEach(inv => {
            let statusBadge = '';
            if (inv.status === 'pending') {
                statusBadge = `<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">Nová k vyřízení</span>`;
            } else if (inv.status === 'approved') {
                statusBadge = `<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">Zaúčtováno</span>`;
            } else {
                statusBadge = `<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300">K doplnění</span>`;
            }

            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition";
            tr.innerHTML = `
                <td class="p-3 pl-4">
                    <div class="font-bold text-slate-900 dark:text-white text-xs">${inv.clientName || 'Klient'}</div>
                    <span class="text-[10px] text-slate-400">ID: ${inv.id}</span>
                </td>
                <td class="p-3">
                    <div class="font-semibold text-slate-800 dark:text-slate-200 text-xs">${inv.vendor || '-'}</div>
                    <div class="text-[11px] text-slate-400">IČO: ${inv.ico || '-'}</div>
                </td>
                <td class="p-3 text-xs">
                    <div class="text-slate-800 dark:text-slate-200 font-semibold">${inv.invoiceNumber ? 'Fa: ' + inv.invoiceNumber : (inv.vs ? 'VS: ' + inv.vs : '-')}</div>
                    <div class="text-slate-500 text-[11px]">DUZP: ${inv.dateTax || inv.dateIssue || '-'}</div>
                    <div class="text-slate-400 text-[11px]">Splatnost: ${inv.dateDue || '-'}</div>
                    <div class="text-[11px] text-blue-600 dark:text-blue-400 font-medium mt-0.5">Nahráno: ${formatDateTime(inv.createdAt)}</div>
                </td>
                <td class="p-3">
                    <div class="font-bold text-slate-900 dark:text-white text-xs">${Number(inv.amount || 0).toLocaleString('cs-CZ')} Kč</div>
                    <div class="text-[10px] text-slate-500">
                        Základ: ${inv.baseAmount ? Number(inv.baseAmount).toLocaleString('cs-CZ') + ' Kč' : '-'}
                    </div>
                    <div class="text-[10px] text-slate-400">
                        DPH (${inv.vatRate || 21}%): ${inv.vatAmount ? Number(inv.vatAmount).toLocaleString('cs-CZ') + ' Kč' : '-'}
                    </div>
                </td>
                <td class="p-3">${statusBadge}</td>
                <td class="p-3 text-right pr-4 whitespace-nowrap">
                    <div class="flex items-center justify-end gap-1.5">
                        <button onclick="openDetailModal('${inv.id}')" class="px-3 py-1.5 bg-blue-50 dark:bg-slate-800 text-blue-600 dark:text-blue-400 hover:bg-blue-100 font-semibold rounded-lg text-xs transition flex items-center gap-1">
                            <i data-lucide="file-text" class="w-3.5 h-3.5"></i>
                            Detail
                        </button>
                        <button onclick="deleteInvoice('${inv.id}')" title="Smazat doklad" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    lucide.createIcons();
    updateAccountantStats(filtered);
}

function updateAccountantStats(filteredList) {
    const list = filteredList || [];
    const pending = list.filter(i => i.status === 'pending').length;
    const approved = list.filter(i => i.status === 'approved').length;
    const totalVolume = list.reduce((sum, i) => sum + Number(i.amount || 0), 0);

    document.getElementById('acc-stat-pending').textContent = pending;
    document.getElementById('acc-stat-approved').textContent = approved;
    document.getElementById('acc-stat-volume').textContent = `${totalVolume.toLocaleString('cs-CZ')} Kč`;
    document.getElementById('acc-stat-total-count').textContent = `Celkem ${list.length} dokladů`;
}

function triggerScan() {
    openModal('scan-modal');
    document.getElementById('scan-dropzone').classList.remove('hidden');
    document.getElementById('scan-preview-img').classList.add('hidden');
    document.getElementById('scan-loading').classList.add('hidden');
    document.getElementById('scan-line-anim').classList.add('hidden');
}

// 1) VYSOKÉ ROZLIŠENÍ (až 1800 px)
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
            document.getElementById('scan-preview-img').src = base64Image;

            await processWithOpenAI(base64Image);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function processWithOpenAI(base64Image) {
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

    try {
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
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Vytáhni data z této faktury/účtenky přesně do JSON s klíči: 'vendor' (Název dodavatele), 'ico' (IČO dodavatele), 'invoiceNumber' (Číslo faktury / dokladu), 'vs' (Variabilní symbol, pokud chybí použij číslo faktury), 'dateIssue' (Datum vystavení ve formátu YYYY-MM-DD), 'dateTax' (Datum zdanitelného plnění / DUZP YYYY-MM-DD), 'dateDue' (Datum splatnosti YYYY-MM-DD), 'baseAmount' (Základ daně bez DPH jako číslo s tečkou bez Kč), 'vatRate' (Sazba DPH: číslo 21, 12 nebo 0), 'vatAmount' (Výše DPH v Kč jako číslo s tečkou), 'amount' (Celková částka k úhradě s DPH jako číslo s tečkou), 'paymentMethod' (Způsob úhrady: 'Převodem', 'Kartou', 'Hotově', 'Zápočtem' nebo 'Dobírka'), 'account' (Číslo bankovního účtu / IBAN)."
                            },
                            { type: "image_url", image_url: { url: base64Image } }
                        ]
                    }
                ]
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
            showToast("Faktura úspěšně přečtena přes umělou inteligenci!", "success");
        } else {
            alert("AI nemohla fakturu přečíst. Zkuste to znovu.");
        }
    } catch (err) {
        alert("Chyba při komunikaci s AI. Pokud chyba přetrvává, zkontrolujte svůj API klíč.");
        localStorage.removeItem('openai_key');
    } finally {
        document.getElementById('scan-loading').classList.add('hidden');
        document.getElementById('scan-line-anim').classList.add('hidden');
    }
}

// 2) ODSTRANĚNÍ DRUHOTNÉHO ZMENŠENÍ NA 300x400 px
async function saveExtractedInvoice(e) {
    e.preventDefault();

    let safeImgUrl = '';
    const previewEl = document.getElementById('scan-preview-img');
    if (previewEl && previewEl.src && previewEl.src.startsWith('data:image')) {
        safeImgUrl = previewEl.src;
    }

    const user = auth.currentUser || currentUser;
    const chosenClient = (currentRole === 'client') ? activeClientCompany : (document.getElementById('field-client-name')?.value || activeClientCompany || 'Moje Firma');

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
        imgUrl: safeImgUrl,
        createdAt: new Date().toISOString()
    };

    try {
        await addDoc(collection(db, "invoices"), newInvoice);
        closeModal('scan-modal');
        showToast(`Doklad byl uložen pod firmu "${chosenClient}"!`, "success");
    } catch (err) {
        console.error("Chyba při zápisu do Firestore:", err);
        alert("CHYBA UKLÁDÁNÍ DO FIREBASE:\n" + err.message);
    }
}

window.calculateScanAmounts = function(source = 'total') {
    const baseInput = document.getElementById('field-base-amount');
    const vatInput = document.getElementById('field-vat-amount');
    const totalInput = document.getElementById('field-amount');
    const rateSelect = document.getElementById('field-vat-rate');
    if (!baseInput || !vatInput || !totalInput || !rateSelect) return;

    const rate = parseFloat(rateSelect.value) || 0;
    let base = parseFloat(baseInput.value) || 0;
    let vat = parseFloat(vatInput.value) || 0;
    let total = parseFloat(totalInput.value) || 0;

    if (source === 'total' || source === 'rate') {
        if (total > 0) {
            if (rate === 0) {
                base = total;
                vat = 0;
            } else {
                base = Math.round((total / (1 + (rate / 100))) * 100) / 100;
                vat = Math.round((total - base) * 100) / 100;
            }
            baseInput.value = base.toFixed(2);
            vatInput.value = vat.toFixed(2);
        }
    } else if (source === 'base') {
        vat = Math.round((base * (rate / 100)) * 100) / 100;
        total = Math.round((base + vat) * 100) / 100;
        vatInput.value = vat.toFixed(2);
        totalInput.value = total.toFixed(2);
    } else if (source === 'vat') {
        if (base > 0) {
            total = Math.round((base + vat) * 100) / 100;
            totalInput.value = total.toFixed(2);
        }
    }
};

window.calculateDetailAmounts = function(source = 'total') {
    const baseInput = document.getElementById('detail-base-amount');
    const vatInput = document.getElementById('detail-vat-amount');
    const totalInput = document.getElementById('detail-amount');
    const rateSelect = document.getElementById('detail-vat');
    if (!baseInput || !vatInput || !totalInput || !rateSelect) return;

    const rate = parseFloat(rateSelect.value) || 0;
    let base = parseFloat(baseInput.value) || 0;
    let vat = parseFloat(vatInput.value) || 0;
    let total = parseFloat(totalInput.value) || 0;

    if (source === 'total' || source === 'rate') {
        if (total > 0) {
            if (rate === 0) {
                base = total;
                vat = 0;
            } else {
                base = Math.round((total / (1 + (rate / 100))) * 100) / 100;
                vat = Math.round((total - base) * 100) / 100;
            }
            baseInput.value = base.toFixed(2);
            vatInput.value = vat.toFixed(2);
        }
    } else if (source === 'base') {
        vat = Math.round((base * (rate / 100)) * 100) / 100;
        total = Math.round((base + vat) * 100) / 100;
        vatInput.value = vat.toFixed(2);
        totalInput.value = total.toFixed(2);
    } else if (source === 'vat') {
        if (base > 0) {
            total = Math.round((base + vat) * 100) / 100;
            totalInput.value = total.toFixed(2);
        }
    }
};

let detailZoom = 1;
let detailRotation = 0;

function updateDetailImgTransform() {
    const img = document.getElementById('detail-img-preview');
    if (img) {
        img.style.transform = `scale(${detailZoom}) rotate(${detailRotation}deg)`;
    }
    const lvl = document.getElementById('detail-zoom-lvl');
    if (lvl) lvl.textContent = `${Math.round(detailZoom * 100)}%`;
}

window.zoomDetailImg = function(delta) {
    detailZoom = Math.max(0.5, Math.min(3.5, Math.round((detailZoom + delta) * 10) / 10));
    updateDetailImgTransform();
};

window.rotateDetailImg = function() {
    detailRotation = (detailRotation + 90) % 360;
    updateDetailImgTransform();
};

window.resetDetailImg = function() {
    detailZoom = 1;
    detailRotation = 0;
    updateDetailImgTransform();
};

// 3) PLNOHODNOTNÝ CELOOBRAZOVKOVÝ PROHLÍŽEČ S MOŽNOSTÍ ZOOMU
window.openDetailImgFull = function() {
    const img = document.getElementById('detail-img-preview');
    if (img && img.src && !img.src.includes('placehold.co')) {
        const w = window.open("");
        w.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Originální náhled dokladu - Plné rozlišení</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { margin: 0; background: #0b0f19; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; padding: 20px; box-sizing: border-box; }
                    img { max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.8); cursor: zoom-in; }
                </style>
            </head>
            <body>
                <img src="${img.src}" onclick="this.style.maxWidth = this.style.maxWidth === 'none' ? '100%' : 'none'; this.style.cursor = this.style.maxWidth === 'none' ? 'zoom-out' : 'zoom-in';" title="Klikněte pro 100% přiblížení v plné velikosti">
            </body>
            </html>
        `);
    }
};

function openDetailModal(id) {
    selectedInvoiceId = id;
    window.selectedInvoiceId = id;
    const inv = invoices.find(i => i.id === id);
    if (!inv) return;

    document.getElementById('detail-modal-title').textContent = `Detail a editace dokladu`;
    document.getElementById('detail-doc-id').textContent = `ID: ${inv.id}`;
    document.getElementById('detail-created-at').textContent = inv.createdAt ? `Nahráno: ${formatDateTime(inv.createdAt)}` : '';

    resetDetailImg();
    document.getElementById('detail-img-preview').src = inv.imgUrl || 'https://placehold.co/600x800/f1f5f9/334155?text=Bez+nahledu';

    const clientSelect = document.getElementById('detail-client-select');
    if (clientSelect) {
        clientSelect.innerHTML = '';
        const allClients = getAllClientNames();
        allClients.forEach(name => {
            clientSelect.add(new Option(name, name));
        });
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

window.saveDetailChanges = async function(e) {
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
};

async function clientSubmitInvoice() {
    if (!selectedInvoiceId) return;
    const noteText = document.getElementById('detail-comment-note').value;
    try {
        const docRef = doc(db, "invoices", selectedInvoiceId);
        await updateDoc(docRef, {
            status: 'pending',
            note: noteText
        });
        closeModal('detail-modal');
        showToast("Doklad byl odeslán účetní ke kontrole!", "success");
    } catch (err) {
        console.error("Chyba při odesílání účetní:", err);
        showToast("Chyba při odesílání: " + err.message, "warning");
    }
}

function deleteCurrentInvoice() {
    if (selectedInvoiceId) {
        deleteInvoice(selectedInvoiceId);
    }
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

        let statusText = "Rozpracováno";
        let toastType = "info";
        if (newStatus === 'approved') {
            statusText = "Zaúčtováno";
            toastType = "success";
        } else if (newStatus === 'action_needed' || newStatus === 'rejected') {
            statusText = "Vráceno k doplnění";
            toastType = "warning";
        }

        showToast(`Stav dokladu: ${statusText}`, toastType);
    } catch (err) {
        console.error("Chyba při aktualizaci stavu:", err);
        showToast("Chyba při ukládání stavu: " + err.message, "warning");
    }
}

function escapeXml(unsafe) {
    if (unsafe === undefined || unsafe === null) return '';
    return String(unsafe).replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case "'": return '&apos;';
            case '"': return '&quot;';
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

    let paymentCode = '31';
    if (paymentMethod === 'Hotově') paymentCode = '10';
    else if (paymentMethod === 'Kartou') paymentCode = '48';
    else if (paymentMethod === 'Zápočtem') paymentCode = '97';

    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.1">
  <DocumentType>1</DocumentType>
  <ID>${escapeXml(docId)}</ID>
  <UUID>${escapeXml(inv.id || '00000000-0000-0000-0000-000000000000')}</UUID>
  <IssuingSystem>InvoiceAI Flow</IssuingSystem>
  <IssueDate>${escapeXml(issueDate)}</IssueDate>
  <TaxPointDate>${escapeXml(taxDate)}</TaxPointDate>
  <VATApplicable>true</VATApplicable>
  <ElectronicPossibilityAgreementReference>N/A</ElectronicPossibilityAgreementReference>
  <Note>${escapeXml(inv.note || '')}</Note>
  <LocalCurrencyCode>CZK</LocalCurrencyCode>
  <CurrRate>1</CurrRate>
  <RefCurrRate>1</RefCurrRate>
  <AccountingSupplierParty>
    <Party>
      <PartyIdentification>
        <ID>${escapeXml(ico)}</ID>
      </PartyIdentification>
      <PartyName>
        <Name>${escapeXml(vendorName)}</Name>
      </PartyName>
    </Party>
  </AccountingSupplierParty>
  <AccountingCustomerParty>
    <Party>
      <PartyName>
        <Name>${escapeXml(clientName)}</Name>
      </PartyName>
    </Party>
  </AccountingCustomerParty>
  <PaymentMeans>
    <Payment>
      <PaidAmount>${amount}</PaidAmount>
      <PaymentMeansCode>${paymentCode}</PaymentMeansCode>
      <Details>
        <PaymentDueDate>${escapeXml(dueDate)}</PaymentDueDate>
        <ID>${escapeXml(bankAccount)}</ID>
        <VariableSymbol>${escapeXml(vs)}</VariableSymbol>
      </Details>
    </Payment>
  </PaymentMeans>
  <TaxTotal>
    <TaxSubTotal>
      <TaxableAmount>${baseAmount}</TaxableAmount>
      <TaxAmount>${vatAmount}</TaxAmount>
      <TaxCategory>
        <Percent>${vatRate}</Percent>
        <VATCalculationMethod>0</VATCalculationMethod>
      </TaxCategory>
    </TaxSubTotal>
    <TaxAmount>${vatAmount}</TaxAmount>
  </TaxTotal>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount>${baseAmount}</TaxExclusiveAmount>
    <TaxInclusiveAmount>${amount}</TaxInclusiveAmount>
    <AlreadyClaimedDateTaxExclusiveAmount>0.00</AlreadyClaimedDateTaxExclusiveAmount>
    <AlreadyClaimedTaxInclusiveAmount>0.00</AlreadyClaimedTaxInclusiveAmount>
    <DifferenceTaxExclusiveAmount>${baseAmount}</DifferenceTaxExclusiveAmount>
    <DifferenceTaxInclusiveAmount>${amount}</DifferenceTaxInclusiveAmount>
    <PayableRoundingAmount>0.00</PayableRoundingAmount>
    <PaidDepositsAmount>0.00</PaidDepositsAmount>
    <PayableAmount>${amount}</PayableAmount>
  </LegalMonetaryTotal>
  <InvoiceLines>
    <InvoiceLine>
      <ID>1</ID>
      <InvoicedQuantity unitCode="C62">1</InvoicedQuantity>
      <LineExtensionAmount>${baseAmount}</LineExtensionAmount>
      <LineExtensionAmountTaxInclusive>${amount}</LineExtensionAmountTaxInclusive>
      <LineExtensionTaxAmount>${vatAmount}</LineExtensionTaxAmount>
      <UnitPrice>${baseAmount}</UnitPrice>
      <UnitPriceTaxInclusive>${amount}</UnitPriceTaxInclusive>
      <ClassifiedTaxCategory>
        <Percent>${vatRate}</Percent>
        <VATCalculationMethod>0</VATCalculationMethod>
      </ClassifiedTaxCategory>
      <Item>
        <Description>${escapeXml(vendorName + ' - ' + (inv.type || 'Faktura'))}</Description>
      </Item>
    </InvoiceLine>
  </InvoiceLines>
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
    const user = auth.currentUser || currentUser;
    const targetId = id || selectedInvoiceId;
    let inv = invoices.find(i => i.id === targetId);
    if (!inv) {
        showToast("Faktura nenalezena nebo není vybrána.", "warning");
        return;
    }

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
    showToast(`ISDOC soubor "${filename}" byl úspěšně stažen!`, "success");
};

function exportInvoices(format) {
    const clientFilter = document.getElementById('acc-client-select')?.value || 'all';
    const user = auth.currentUser || currentUser;
    let list = [];

    if (window.isDemoMode) {
        list = invoices.filter(i => i.status === 'approved');
    } else if (user && currentRole === 'accountant') {
        list = invoices.filter(i => i.status === 'approved' && (i.accountantId === user.uid || i.userId === user.uid));
    }

    if (clientFilter !== 'all') {
        list = list.filter(i => i.clientName === clientFilter);
    }

    if (list.length === 0) {
        showToast("Žádné zaúčtované faktury k exportu. Označte faktury jako 'Zaúčtovat'.", "warning");
        return;
    }

    if (format === 'isdoc') {
        list.forEach((inv, idx) => {
            setTimeout(() => {
                const xml = generateISDOCXml(inv);
                const filename = `ISDOC_${inv.clientName ? inv.clientName.replace(/[^a-zA-Z0-9]/g, '_') : 'firma'}_${inv.invoiceNumber || inv.vs || inv.id}.isdoc`;
                triggerDownload(xml, filename, 'application/xml;charset=utf-8');
            }, idx * 250);
        });
        showToast(`Vygenerováno a staženo ${list.length} ISDOC souborů pro Money S3 / Pohodu!`, "success");
    }
}

function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    
    let bgBg = 'bg-slate-900 border-slate-700 text-white';
    let icon = 'info';

    if (type === 'success') {
        bgBg = 'bg-emerald-600 border-emerald-500 text-white';
        icon = 'check-circle';
    } else if (type === 'warning') {
        bgBg = 'bg-amber-600 border-amber-500 text-white';
        icon = 'alert-triangle';
    }

    toast.className = `p-3.5 rounded-xl border shadow-xl flex items-center gap-2.5 text-xs font-medium transform transition duration-300 translate-y-2 opacity-0 ${bgBg} pointer-events-auto`;
    toast.innerHTML = `
        <i data-lucide="${icon}" class="w-4 h-4 shrink-0"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);
    lucide.createIcons();

    setTimeout(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
    }, 10);

    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

window.switchRole = switchRole;
window.triggerScan = triggerScan;
window.handleFileSelect = handleFileSelect;
window.saveExtractedInvoice = saveExtractedInvoice;
window.openDetailModal = openDetailModal;
window.updateInvoiceStatus = updateInvoiceStatus;
window.deleteInvoice = deleteInvoice;
window.deleteCurrentInvoice = deleteCurrentInvoice;
window.saveDetailChanges = saveDetailChanges;
window.downloadSingleISDOC = downloadSingleISDOC;
window.clientSubmitInvoice = clientSubmitInvoice;
window.renameClient = renameClient;
window.deleteClient = deleteClient;
window.addNewClientFromInput = addNewClientFromInput;
window.renderClientsModalTable = renderClientsModalTable;
window.openClientDetailModal = openClientDetailModal;
window.saveClientDetailChanges = saveClientDetailChanges;
window.copyModalPin = copyModalPin;
window.toggleProfileDropdown = toggleProfileDropdown;
window.openAccountSettingsModal = openAccountSettingsModal;
window.saveAccountSettings = saveAccountSettings;
window.openChangePasswordModal = openChangePasswordModal;
window.handleChangePassword = handleChangePassword;
window.sendResetPasswordLink = sendResetPasswordLink;
window.handleForgotPassword = handleForgotPassword;
window.toggleTheme = toggleTheme;
window.copyPairingCode = copyPairingCode;
window.filterClientInvoices = filterClientInvoices;
window.renderClientInvoices = renderClientInvoices;
window.renderAccountantInvoices = renderAccountantInvoices;
window.exportInvoices = exportInvoices;
window.handleAuthSubmit = handleAuthSubmit;
window.handleLogout = handleLogout;
window.setAuthMode = setAuthMode;
window.updateRoleTypeUI = updateRoleTypeUI;
window.continueAsDemo = continueAsDemo;
window.openModal = openModal;
window.closeModal = closeModal;
window.showToast = showToast;

window.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    renderClientInvoices();
    renderAccountantInvoices();
});
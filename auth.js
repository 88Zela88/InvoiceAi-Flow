import { auth, db } from './firebase.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword, sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { showToast, closeModal, openModal, closeProfileDropdown, generatePairingPin } from './ui.js';

export let currentUser = null;
export let currentUserData = null;
export let currentRole = 'client';
export let activeClientCompany = 'Moje Firma s.r.o.';
export let activeAccountantCompany = 'Účetní kancelář';
export let authMode = 'signin';

export function setCurrentRole(role) {
    currentRole = role;
}

export function setDemoState() {
    currentUser = null;
    currentUserData = null;
    currentRole = 'client';
    activeClientCompany = 'TechVision s.r.o.';
    activeAccountantCompany = 'Účetní kancelář ProFit s.r.o.';
}

export function initAuthListener() {
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

            const displayEmail = document.getElementById('user-display-email');
            const menuEmail = document.getElementById('menu-user-email');
            const avatar = document.getElementById('user-avatar');
            if (displayEmail) displayEmail.textContent = user.email || 'Přihlášený uživatel';
            if (menuEmail) menuEmail.textContent = user.email || 'Přihlášený uživatel';
            if (avatar) avatar.textContent = (user.email ? user.email[0].toUpperCase() : 'U');

            try {
                const userSnap = await getDoc(doc(db, "users", user.uid));
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
            const displayRoleEl = document.getElementById('user-display-role');
            const menuCompanyEl = document.getElementById('menu-user-company');
            if (displayRoleEl) displayRoleEl.textContent = roleDisplay;
            if (menuCompanyEl) menuCompanyEl.textContent = roleDisplay;

            if (typeof window.switchRole === 'function') window.switchRole(currentRole);
            showToast(`Vítejte zpět, ${user.email}!`, "success");
        } else {
            if (!window.isDemoMode) {
                if (landingPage) landingPage.classList.remove('hidden');
                if (appContainer) appContainer.classList.add('hidden');
            }
        }

        // Obnovení UI
        if (typeof window.updateDynamicClients === 'function') window.updateDynamicClients();
        if (typeof window.renderClientsModalTable === 'function') window.renderClientsModalTable();
        if (typeof window.renderClientInvoices === 'function') window.renderClientInvoices();
        if (typeof window.renderAccountantInvoices === 'function') window.renderAccountantInvoices();
        if (window.lucide) window.lucide.createIcons();
    });
}

export function setAuthMode(mode) {
    authMode = mode;
    const landIn = document.getElementById('landing-tab-signin');
    const landUp = document.getElementById('landing-tab-signup');
    const landTitle = document.getElementById('landing-auth-title');
    const extraFields = document.getElementById('signup-extra-fields');
    const submitLabel = document.getElementById('auth-submit-label');
    const forgotBox = document.getElementById('forgot-password-box');

    if (mode === 'signin') {
        if (landIn) landIn.className = "flex-1 py-1.5 sm:py-2 rounded-lg text-xs font-bold transition bg-slate-900 text-white shadow-sm";
        if (landUp) landUp.className = "flex-1 py-1.5 sm:py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 transition";
        if (landTitle) landTitle.textContent = "Přihlášení do systému";
        if (extraFields) extraFields.classList.add('hidden');
        if (submitLabel) submitLabel.textContent = "Přihlásit se do systému";
        if (forgotBox) forgotBox.classList.remove('hidden');
    } else {
        if (landUp) landUp.className = "flex-1 py-1.5 sm:py-2 rounded-lg text-xs font-bold transition bg-slate-900 text-white shadow-sm";
        if (landIn) landIn.className = "flex-1 py-1.5 sm:py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 transition";
        if (landTitle) landTitle.textContent = "Vytvoření nového účtu";
        if (extraFields) extraFields.classList.remove('hidden');
        if (submitLabel) submitLabel.textContent = "Vytvořit nový účet";
        if (forgotBox) forgotBox.classList.add('hidden');
    }
}

export function updateRoleTypeUI(role) {
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
}

export async function handleAuthSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email')?.value?.trim();
    const password = document.getElementById('auth-password')?.value;
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
                const newPin = generatePairingPin();
                await addDoc(collection(db, "clients"), {
                    name: finalCompany,
                    pairingCode: newPin,
                    accountantId: cred.user.uid,
                    userId: cred.user.uid,
                    createdAt: new Date().toISOString()
                });
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
}

export async function handleForgotPassword() {
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
}

export async function handleLogout() {
    try {
        await signOut(auth);
        currentUser = null;
        currentUserData = null;
        window.isDemoMode = false;
        currentRole = 'client';
        activeClientCompany = 'TechVision s.r.o.';

        ['auth-email', 'auth-password', 'auth-accountant-company', 'auth-pairing-code', 'auth-client-company'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        closeProfileDropdown();

        const landingPage = document.getElementById('landing-page');
        const appContainer = document.getElementById('app');
        if (landingPage) landingPage.classList.remove('hidden');
        if (appContainer) appContainer.classList.add('hidden');

        showToast("Byl jste úspěšně odhlášen.", "info");
        if (window.lucide) window.lucide.createIcons();
    } catch (err) {
        console.error("Chyba při odhlašování:", err);
    }
}

export function openAccountSettingsModal() {
    closeProfileDropdown();
    const user = auth.currentUser;
    const emailEl = document.getElementById('settings-email');
    const compEl = document.getElementById('settings-company');
    const labelEl = document.getElementById('settings-company-label');
    if (emailEl) emailEl.value = user ? user.email : 'demo@email.cz';
    if (compEl) compEl.value = currentRole === 'accountant' ? activeAccountantCompany : activeClientCompany;
    if (labelEl) labelEl.textContent = currentRole === 'accountant' ? 'Název účetní kanceláře' : 'Název vaší firmy';
    openModal('account-settings-modal');
}

export async function saveAccountSettings(e) {
    e.preventDefault();
    const newName = document.getElementById('settings-company')?.value?.trim();
    if (!newName) return;

    const user = auth.currentUser;
    if (user && !window.isDemoMode) {
        try {
            await updateDoc(doc(db, "users", user.uid), { company: newName });
            if (currentRole === 'accountant') {
                activeAccountantCompany = newName;
                const badge = document.getElementById('acc-agency-badge');
                if (badge) badge.textContent = `Účetní kancelář: ${newName}`;
            } else {
                activeClientCompany = newName;
                const badge = document.getElementById('current-client-badge');
                if (badge) badge.textContent = `Firma: ${newName}`;
            }
            const roleEl = document.getElementById('user-display-role');
            const compEl = document.getElementById('menu-user-company');
            if (roleEl) roleEl.textContent = currentRole === 'accountant' ? newName : `Klient (${newName})`;
            if (compEl) compEl.textContent = newName;
            showToast("Nastavení účtu bylo úspěšně uloženo!", "success");
            closeModal('account-settings-modal');
        } catch (err) {
            alert("Chyba při ukládání: " + err.message);
        }
    } else {
        if (currentRole === 'accountant') {
            activeAccountantCompany = newName;
            const badge = document.getElementById('acc-agency-badge');
            if (badge) badge.textContent = `Účetní kancelář: ${newName}`;
        } else {
            activeClientCompany = newName;
            const badge = document.getElementById('current-client-badge');
            if (badge) badge.textContent = `Firma: ${newName}`;
        }
        showToast("V demo režimu bylo nastavení změněno lokálně.", "info");
        closeModal('account-settings-modal');
    }
}

export function openChangePasswordModal() {
    closeProfileDropdown();
    ['current-password', 'new-password', 'confirm-new-password'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    openModal('change-password-modal');
}

export async function handleChangePassword(e) {
    e.preventDefault();
    const currentPass = document.getElementById('current-password')?.value;
    const p1 = document.getElementById('new-password')?.value;
    const p2 = document.getElementById('confirm-new-password')?.value;

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
}

export async function sendResetPasswordLink() {
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
}

// Navázání na window pro přímé volání z HTML (landing page & modaly)
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

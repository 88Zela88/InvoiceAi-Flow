import { auth, db } from './firebase.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword, sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { showToast, closeModal, openModal } from './ui.js';
import { addNewClient } from './app.js'; // Získání ref

export let currentUser = null;
export let currentUserData = null;
export let currentRole = 'client';
export let activeClientCompany = 'Moje Firma s.r.o.';
export let activeAccountantCompany = 'Účetní kancelář';
export let authMode = 'signin';

export function setAuthMode(mode) {
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
                        showToast(`Účet spárován s firmou ${finalCompany}!`, "success");
                    } else {
                        alert(`Zadaný kód "${pinInput}" nebyl nalezen.`);
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
        console.error(err);
        alert("Chyba ověření: " + err.message);
    }
}

export async function handleForgotPassword() {
    let email = document.getElementById('auth-email')?.value?.trim();
    if (!email) email = prompt("Zadejte svůj e-mail pro reset hesla:");
    if (!email) return;

    try {
        await sendPasswordResetEmail(auth, email);
        alert(`Odkaz odeslán na ${email}.`);
        showToast("E-mail odeslán!", "success");
    } catch (err) {
        alert("Chyba: " + err.message);
    }
}

export async function handleLogout() {
    try {
        await signOut(auth);
        currentUser = null;
        currentUserData = null;
        window.isDemoMode = false;
        
        ['auth-email', 'auth-password', 'auth-accountant-company', 'auth-pairing-code', 'auth-client-company'].forEach(id => {
            if(document.getElementById(id)) document.getElementById(id).value = '';
        });

        const menu = document.getElementById('profile-dropdown-menu');
        if (menu) menu.classList.add('hidden');

        document.getElementById('landing-page')?.classList.remove('hidden');
        document.getElementById('app')?.classList.add('hidden');
        showToast("Byl jste úspěšně odhlášen.", "info");
    } catch (err) {
        console.error(err);
    }
}

export function openAccountSettingsModal() {
    document.getElementById('profile-dropdown-menu')?.classList.add('hidden');
    document.getElementById('settings-email').value = auth.currentUser ? auth.currentUser.email : 'demo@email.cz';
    document.getElementById('settings-company').value = currentRole === 'accountant' ? activeAccountantCompany : activeClientCompany;
    document.getElementById('settings-company-label').textContent = currentRole === 'accountant' ? 'Název účetní kanceláře' : 'Název vaší firmy';
    openModal('account-settings-modal');
}

export async function saveAccountSettings(e) {
    e.preventDefault();
    const newName = document.getElementById('settings-company').value.trim();
    if (!newName) return;

    if (auth.currentUser && !window.isDemoMode) {
        try {
            await updateDoc(doc(db, "users", auth.currentUser.uid), { company: newName });
            if (currentRole === 'accountant') {
                activeAccountantCompany = newName;
                document.getElementById('acc-agency-badge').textContent = `Účetní kancelář: ${newName}`;
            } else {
                activeClientCompany = newName;
                document.getElementById('current-client-badge').textContent = `Firma: ${newName}`;
            }
            document.getElementById('user-display-role').textContent = currentRole === 'accountant' ? newName : `Klient (${newName})`;
            document.getElementById('menu-user-company').textContent = newName;
            showToast("Nastavení účtu uloženo!", "success");
            closeModal('account-settings-modal');
        } catch (err) {
            alert("Chyba při ukládání: " + err.message);
        }
    }
}

export function openChangePasswordModal() {
    document.getElementById('profile-dropdown-menu')?.classList.add('hidden');
    ['current-password', 'new-password', 'confirm-new-password'].forEach(id => document.getElementById(id).value = '');
    openModal('change-password-modal');
}

export async function handleChangePassword(e) {
    e.preventDefault();
    const currentPass = document.getElementById('current-password').value;
    const p1 = document.getElementById('new-password').value;
    const p2 = document.getElementById('confirm-new-password').value;

    if (p1 !== p2) return alert("Hesla se neshodují!");
    if (!auth.currentUser) return alert("Musíte být přihlášeni.");

    try {
        const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPass);
        await reauthenticateWithCredential(auth.currentUser, credential);
        await updatePassword(auth.currentUser, p1);
        showToast("Heslo úspěšně změněno!", "success");
        closeModal('change-password-modal');
    } catch (err) {
        alert("Chyba: " + err.message);
    }
}

export async function sendResetPasswordLink() {
    const email = auth.currentUser ? auth.currentUser.email : prompt("Zadejte e-mail:");
    if (!email) return;

    try {
        await sendPasswordResetEmail(auth, email);
        showToast(`Odkaz odeslán na ${email}!`, "success");
        closeModal('change-password-modal');
    } catch (err) {
        alert("Chyba: " + err.message);
    }
}

export function setCurrentUserValues(user, userData, role, cCompany, aCompany) {
    currentUser = user;
    currentUserData = userData;
    currentRole = role;
    activeClientCompany = cCompany;
    activeAccountantCompany = aCompany;
}
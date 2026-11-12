export function openModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('hidden');
}

export function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.add('hidden');
}

export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    const bgBg = type === 'success' ? 'bg-emerald-600 border-emerald-500' : type === 'warning' ? 'bg-amber-600 border-amber-500' : 'bg-slate-900 border-slate-700';
    const icon = type === 'success' ? 'check-circle' : type === 'warning' ? 'alert-triangle' : 'info';

    toast.className = `p-3.5 rounded-xl border shadow-xl flex items-center gap-2.5 text-xs font-medium transform transition duration-300 translate-y-2 opacity-0 text-white pointer-events-auto ${bgBg}`;
    toast.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4 shrink-0"></i><span>${message}</span>`;
    container.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();
    setTimeout(() => toast.classList.remove('translate-y-2', 'opacity-0'), 10);
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

export function formatDateTime(isoString) {
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

export function generatePairingPin() {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const numbers = "23456789";
    let pin = "";
    for (let i = 0; i < 3; i++) pin += letters.charAt(Math.floor(Math.random() * letters.length));
    pin += "-";
    for (let i = 0; i < 3; i++) pin += numbers.charAt(Math.floor(Math.random() * numbers.length));
    return pin;
}

export function closeProfileDropdown() {
    const menu = document.getElementById('profile-dropdown-menu');
    const chevron = document.getElementById('profile-dropdown-chevron');
    if (menu) menu.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
}

export function toggleProfileDropdown() {
    const menu = document.getElementById('profile-dropdown-menu');
    const chevron = document.getElementById('profile-dropdown-chevron');
    if (menu) {
        if (menu.classList.contains('hidden')) {
            menu.classList.remove('hidden');
            if (chevron) chevron.classList.add('rotate-180');
        } else {
            closeProfileDropdown();
        }
    }
}

export function updateThemeUI(isDark) {
    const label = document.getElementById('theme-label');
    const badge = document.getElementById('theme-badge');
    if (label && badge) {
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

export function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeUI(isDark);
}

export function initTheme() {
    if (localStorage.getItem('theme') === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
        updateThemeUI(true);
    } else {
        document.documentElement.classList.remove('dark');
        updateThemeUI(false);
    }
}

// Navázání na window pro přímé volání z HTML
window.openModal = openModal;
window.closeModal = closeModal;
window.showToast = showToast;
window.formatDateTime = formatDateTime;
window.closeProfileDropdown = closeProfileDropdown;
window.toggleProfileDropdown = toggleProfileDropdown;
window.toggleTheme = toggleTheme;

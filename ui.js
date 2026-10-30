export function openModal(id) {
    const m = document.getElementById(id);
    if(m) m.classList.remove('hidden');
}

export function closeModal(id) {
    const m = document.getElementById(id);
    if(m) m.classList.add('hidden');
}

export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if(!container) return;
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
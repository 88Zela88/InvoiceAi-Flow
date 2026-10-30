export function openModal(id) { 
    document.getElementById(id).classList.remove('hidden'); 
}

export function closeModal(id) { 
    document.getElementById(id).classList.add('hidden'); 
}

export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
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

export function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeUI(isDark);
}

export function updateThemeUI(isDark) {
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

export function closeProfileDropdown() {
    const menu = document.getElementById('profile-dropdown-menu');
    const chevron = document.getElementById('profile-dropdown-chevron');
    if (menu) menu.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
}

export let detailZoom = 1;
export let detailRotation = 0;

export function updateDetailImgTransform() {
    const img = document.getElementById('detail-img-preview');
    if (img) {
        img.style.transform = `scale(${detailZoom}) rotate(${detailRotation}deg)`;
    }
    const lvl = document.getElementById('detail-zoom-lvl');
    if (lvl) lvl.textContent = `${Math.round(detailZoom * 100)}%`;
}

export function zoomDetailImg(delta) {
    detailZoom = Math.max(0.5, Math.min(3.5, Math.round((detailZoom + delta) * 10) / 10));
    updateDetailImgTransform();
}

export function rotateDetailImg() {
    detailRotation = (detailRotation + 90) % 360;
    updateDetailImgTransform();
}

export function resetDetailImg() {
    detailZoom = 1;
    detailRotation = 0;
    updateDetailImgTransform();
}

export function switchDetailPage(dir) {
    if (dir === -1 && window.activeDetailPageIdx > 0) window.activeDetailPageIdx--;
    if (dir === 1 && window.activeDetailPageIdx < window.currentInvoicePages.length - 1) window.activeDetailPageIdx++;
    
    document.getElementById('detail-img-preview').src = window.currentInvoicePages[window.activeDetailPageIdx] || '';
    updateDetailPagesUI();
    resetDetailImg();
}

export function updateDetailPagesUI() {
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

export function openDetailImgFull() {
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
                    .close-btn:active { background: #dc2626; transform: scale(0.96); }
                    .img-container { padding: 16px; width: 100%; display: flex; justify-content: center; box-sizing: border-box; overflow: auto; }
                    img { max-width: 100%; height: auto; border-radius: 6px; box-shadow: 0 10px 40px rgba(0,0,0,0.8); cursor: zoom-in; transition: transform 0.2s; }
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
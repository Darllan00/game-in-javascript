const loadingScreen = document.getElementById('loading-screen');
const loadingStatus = document.getElementById('loading-status');
const loadingBarFill = document.getElementById('loading-bar-fill');

export function showLoadingScreen(status = 'Preparando mundo...') {
    if (!loadingScreen) return;
    loadingScreen.classList.add('is-visible');
    loadingScreen.setAttribute('aria-hidden', 'false');
    updateLoadingScreen(0, status);
}

export function updateLoadingScreen(progress, status = null) {
    if (loadingStatus && status) {
        loadingStatus.textContent = status;
    }
    if (loadingBarFill) {
        const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
        loadingBarFill.style.width = `${percent}%`;
    }
}

export function hideLoadingScreen() {
    if (!loadingScreen) return;
    updateLoadingScreen(1, 'Pronto');
    loadingScreen.classList.remove('is-visible');
    loadingScreen.setAttribute('aria-hidden', 'true');
}

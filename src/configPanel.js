import {
    CONFIG,
    CONFIG_CONTROLS,
    CONFIG_DEFAULTS,
    getConfigValue,
    resetConfigOverrides,
    setConfigOverride
} from './config.js';

function createElement(tag, className = '', text = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function formatValue(value) {
    if (typeof value === 'number') {
        return Number.isInteger(value) ? `${value}` : `${Number(value.toFixed(3))}`;
    }
    return `${value}`;
}

function applyLiveEffects(control, renderer) {
    if (control.path === 'iluminacao.exposicao' && renderer) {
        renderer.toneMappingExposure = CONFIG.iluminacao?.exposicao ?? 1;
    }
}

function createInput(control, renderer, markReloadNeeded) {
    const currentValue = getConfigValue(control.path);
    const defaultValue = getConfigValue(control.path, CONFIG_DEFAULTS);
    const row = createElement('label', 'config-row');
    const header = createElement('span', 'config-row-header');
    const title = createElement('span', 'config-row-title', control.label);
    const valueText = createElement('span', 'config-row-value', formatValue(currentValue));
    const defaultText = createElement('span', 'config-row-default', `padrao ${formatValue(defaultValue)}`);

    header.append(title, valueText);
    row.append(header);

    let input;
    if (control.type === 'boolean') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = Boolean(currentValue);
        input.className = 'config-checkbox';
    } else if (control.type === 'select' || control.type === 'select-number') {
        input = document.createElement('select');
        input.className = 'config-select';
        for (const optionValue of control.options) {
            const option = document.createElement('option');
            option.value = `${optionValue}`;
            option.textContent = formatValue(optionValue);
            option.selected = optionValue === currentValue;
            input.appendChild(option);
        }
    } else {
        input = document.createElement('input');
        input.type = 'number';
        input.className = 'config-number';
        input.min = `${control.min ?? ''}`;
        input.max = `${control.max ?? ''}`;
        input.step = `${control.step ?? 1}`;
        input.value = formatValue(currentValue);
    }

    input.addEventListener('input', () => {
        const rawValue = control.type === 'boolean'
            ? input.checked
            : control.type === 'select-number'
                ? Number(input.value)
                : control.type === 'select'
                    ? input.value
                    : Number(input.value);
        setConfigOverride(control.path, rawValue);
        const nextValue = getConfigValue(control.path);
        valueText.textContent = formatValue(nextValue);
        if (control.reload) {
            markReloadNeeded();
        } else if (control.live) {
            applyLiveEffects(control, renderer);
        }
    });

    row.append(input, defaultText);
    return row;
}

export function createConfigPanel({ renderer } = {}) {
    const root = createElement('div', 'config-ui');
    const toggle = createElement('button', 'config-toggle', 'Configs');
    toggle.type = 'button';

    const panel = createElement('section', 'config-panel');
    panel.setAttribute('aria-hidden', 'true');
    panel.addEventListener('click', (event) => event.stopPropagation());
    panel.addEventListener('mousedown', (event) => event.stopPropagation());

    const titleRow = createElement('div', 'config-title-row');
    const title = createElement('div', 'config-title', 'Configuracoes');
    const closeButton = createElement('button', 'config-close', 'Fechar');
    closeButton.type = 'button';
    titleRow.append(title, closeButton);

    const tabs = createElement('div', 'config-tabs');
    const content = createElement('div', 'config-content');
    const status = createElement('div', 'config-status');
    const actions = createElement('div', 'config-actions');
    const resetButton = createElement('button', 'config-action', 'Resetar');
    const reloadButton = createElement('button', 'config-action config-primary', 'Recarregar');
    resetButton.type = 'button';
    reloadButton.type = 'button';
    actions.append(resetButton, reloadButton);
    panel.append(titleRow, tabs, content, status, actions);
    root.append(toggle, panel);
    document.body.appendChild(root);

    const sectionElements = new Map();
    let activeSection = CONFIG_CONTROLS[0]?.id ?? '';
    let reloadNeeded = false;

    function setStatus(text, isWarning = false) {
        status.textContent = text;
        status.classList.toggle('is-warning', isWarning);
    }

    function markReloadNeeded() {
        reloadNeeded = true;
        root.classList.add('needs-reload');
        setStatus('Alteracao salva. Recarregue para aplicar tudo com seguranca.', true);
    }

    function setOpen(isOpen) {
        root.classList.toggle('is-open', isOpen);
        panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        if (isOpen) {
            document.exitPointerLock?.();
        }
    }

    function activateSection(sectionId) {
        activeSection = sectionId;
        for (const [id, section] of sectionElements) {
            section.tab.classList.toggle('is-active', id === activeSection);
            section.body.classList.toggle('is-active', id === activeSection);
        }
    }

    for (const section of CONFIG_CONTROLS) {
        const tab = createElement('button', 'config-tab', section.label);
        tab.type = 'button';
        tab.addEventListener('click', () => activateSection(section.id));
        tabs.appendChild(tab);

        const body = createElement('div', 'config-section');
        for (const control of section.controls) {
            body.appendChild(createInput(control, renderer, markReloadNeeded));
        }
        content.appendChild(body);
        sectionElements.set(section.id, { tab, body });
    }
    activateSection(activeSection);
    setStatus('Configs salvas ficam neste navegador.');

    toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        setOpen(!root.classList.contains('is-open'));
    });
    closeButton.addEventListener('click', () => setOpen(false));
    resetButton.addEventListener('click', () => {
        resetConfigOverrides();
        reloadNeeded = true;
        setStatus('Padroes restaurados. Recarregue para reconstruir o mundo.', true);
        root.classList.add('needs-reload');
    });
    reloadButton.addEventListener('click', () => {
        window.location.reload();
    });

    function onKeyDown(event) {
        if (event.code === 'F2') {
            event.preventDefault();
            setOpen(!root.classList.contains('is-open'));
        } else if (event.code === 'Escape' && root.classList.contains('is-open')) {
            event.preventDefault();
            setOpen(false);
        }
    }

    window.addEventListener('keydown', onKeyDown);

    return {
        dispose() {
            window.removeEventListener('keydown', onKeyDown);
            root.remove();
        },
        get reloadNeeded() {
            return reloadNeeded;
        }
    };
}

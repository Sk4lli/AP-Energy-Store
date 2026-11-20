// Loads plain text language files from /lang (key=value, # starts a comment).

export const LANGUAGES = [
    { code: 'de_DE', name: 'Deutsch' },
    { code: 'en_US', name: 'English' },
];

export const FALLBACK_LANGUAGE = 'en_US';
const STORAGE_KEY = 'ap-energylink-store.lang';

let currentCode = FALLBACK_LANGUAGE;
let currentMap = new Map();
let fallbackMap = new Map();

function parse(text) {
    const map = new Map();
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || line.startsWith(';')) {
            continue;
        }
        const eq = line.indexOf('=');
        if (eq <= 0) {
            continue;
        }
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        value = value.replaceAll('\\n', '\n').replaceAll('\\t', '\t');
        map.set(key, value);
    }
    return map;
}

async function fetchLanguage(code) {
    const response = await fetch(`lang/${code}.lang`, { cache: 'no-cache' });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return parse(await response.text());
}

export function detectLanguage() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGUAGES.some((lang) => lang.code === saved)) {
        return saved;
    }
    const wanted = (navigator.languages?.[0] ?? navigator.language ?? 'en').toLowerCase();
    const match = LANGUAGES.find((lang) => lang.code.toLowerCase() === wanted.replace('-', '_'));
    if (match) {
        return match.code;
    }
    const prefix = wanted.slice(0, 2);
    return LANGUAGES.find((lang) => lang.code.toLowerCase().startsWith(prefix))?.code ?? FALLBACK_LANGUAGE;
}

export async function initI18n(code) {
    fallbackMap = await fetchLanguage(FALLBACK_LANGUAGE);
    return setLanguage(code ?? detectLanguage());
}

export async function setLanguage(code) {
    const map = await fetchLanguage(code);
    currentCode = code;
    currentMap = map;
    localStorage.setItem(STORAGE_KEY, code);
    return code;
}

export function getLanguage() {
    return currentCode;
}

/** Translates a key. Placeholders use {name}. Unknown keys return the key itself. */
export function t(key, vars) {
    if (typeof key !== 'string') {
        return '';
    }
    let text = currentMap.get(key) ?? fallbackMap.get(key) ?? key;
    if (vars) {
        for (const [name, value] of Object.entries(vars)) {
            text = text.replaceAll(`{${name}}`, String(value));
        }
    }
    return text;
}

/** Fills all elements carrying data-i18n* attributes. */
export function applyTranslations(root = document) {
    for (const node of root.querySelectorAll('[data-i18n]')) {
        node.textContent = t(node.dataset.i18n);
    }
    for (const node of root.querySelectorAll('[data-i18n-placeholder]')) {
        node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
    }
    for (const node of root.querySelectorAll('[data-i18n-title]')) {
        node.setAttribute('title', t(node.dataset.i18nTitle));
    }
    for (const node of root.querySelectorAll('[data-i18n-aria-label]')) {
        node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
    }
}

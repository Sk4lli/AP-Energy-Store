// Small helpers shared by all modules.

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function toInt(value, fallback = 0) {
    const n = Number.parseInt(String(value).trim(), 10);
    return Number.isFinite(n) ? n : fallback;
}

export function toFloat(value, fallback = 0) {
    const n = Number.parseFloat(String(value).trim().replace(',', '.'));
    return Number.isFinite(n) ? n : fallback;
}

export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function escapeHtml(text) {
    return String(text ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

const SI_UNITS = [
    [1e15, 'P'],
    [1e12, 'T'],
    [1e9, 'G'],
    [1e6, 'M'],
    [1e3, 'k'],
];

/** Formats a joule value with an SI prefix, e.g. 12345678 -> "12,35 MJ". */
export function formatEnergy(joules, locale = 'en-US') {
    const value = Number(joules);
    if (!Number.isFinite(value)) {
        return '0 J';
    }
    const abs = Math.abs(value);
    for (const [factor, prefix] of SI_UNITS) {
        if (abs >= factor) {
            const scaled = value / factor;
            const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
            const text = new Intl.NumberFormat(locale, {
                minimumFractionDigits: 0,
                maximumFractionDigits: digits,
            }).format(scaled);
            return `${text} ${prefix}J`;
        }
    }
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)} J`;
}

export function formatNumber(value, locale = 'en-US') {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return '0';
    }
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
}

export function localeFromLang(code) {
    return String(code ?? 'en_US').replace('_', '-');
}

/** Creates an element with attributes and children in one call. */
export function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null || value === false) {
            continue;
        }
        if (key === 'class') {
            node.className = value;
        } else if (key === 'text') {
            node.textContent = value;
        } else if (key === 'html') {
            node.innerHTML = value;
        } else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value);
        } else {
            node.setAttribute(key, value === true ? '' : String(value));
        }
    }
    for (const child of Array.isArray(children) ? children : [children]) {
        if (child === null || child === undefined) {
            continue;
        }
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}

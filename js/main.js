// UI wiring: connect form, status, store pages and the console.

import { EnergyLinkStore, CONNECTION_STATE } from './ap.js';
import { StoreModel } from './store.js';
import { Console } from './console.js';
import { LANGUAGES, applyTranslations, getLanguage, initI18n, setLanguage, t } from './i18n.js';
import { el, formatEnergy, formatNumber, localeFromLang } from './util.js';

const store = new EnergyLinkStore();
const model = new StoreModel(getLanguage());
const dom = {
    connectForm: document.getElementById('connect-form'),
    serverInput: document.getElementById('server-input'),
    slotInput: document.getElementById('slot-input'),
    passwordInput: document.getElementById('password-input'),
    connectButton: document.getElementById('connect-button'),
    disconnectButton: document.getElementById('disconnect-button'),
    connectHint: document.getElementById('connect-hint'),
    languageSelect: document.getElementById('language-select'),
    statConnection: document.getElementById('stat-connection'),
    statEnergy: document.getElementById('stat-energy'),
    statSlot: document.getElementById('stat-slot'),
    statGame: document.getElementById('stat-game'),
    statSeed: document.getElementById('stat-seed'),
    statProgress: document.getElementById('stat-progress'),
    statGoal: document.getElementById('stat-goal'),
    storeBalance: document.getElementById('store-balance'),
    pageIndicator: document.getElementById('page-indicator'),
    pageSummary: document.getElementById('page-summary'),
    pageTabs: document.getElementById('page-tabs'),
    locationList: document.getElementById('location-list'),
    storeMessage: document.getElementById('store-message'),
    buyButton: document.getElementById('buy-button'),
    prevButton: document.getElementById('prev-page'),
    nextButton: document.getElementById('next-page'),
};

let consoleUi = null;

/* ---------------------------------------------------------------- language */

function fillLanguageSelect() {
    dom.languageSelect.replaceChildren(
        ...LANGUAGES.map((lang) => el('option', { value: lang.code, text: lang.name })),
    );
    dom.languageSelect.value = getLanguage();
}

async function changeLanguage(code) {
    await setLanguage(code);
    model.setLanguage(code);
    document.documentElement.lang = code.replace('_', '-');
    applyTranslations();
    fillLanguageSelect();
    render();
}

/* ---------------------------------------------------------------- connect */

function setHint(text, kind = '') {
    dom.connectHint.textContent = text;
    dom.connectHint.className = `hint${kind ? ` hint--${kind}` : ''}`;
}

/** Turns the server's refusal reasons into something a player can act on. */
function describeLoginError(error, slot = '') {
    const reasons = error?.errors ?? [];
    if (reasons.length === 0) {
        const message = String(error?.message ?? error);
        if (/Failed to connect/i.test(message)) {
            const tried = error?.triedUrls?.length ? error.triedUrls.join(', ') : (error?.url ?? '');
            return t('connect.error.unreachable', { url: tried });
        }
        return `${t('connect.failed')}: ${message}`;
    }
    const known = reasons.map((reason) => {
        switch (reason) {
            case 'InvalidSlot':
                return t('connect.error.invalidSlot', { slot });
            case 'InvalidGame':
                return t('connect.error.invalidGame');
            case 'InvalidPassword':
                return t('connect.error.invalidPassword');
            case 'IncompatibleVersion':
                return t('connect.error.version');
            case 'InvalidItemsHandling':
                return t('connect.error.items');
            default:
                return reason;
        }
    });
    return t('connect.refused', { errors: known.join(' · ') });
}

async function doConnect({ server, slot, password }) {
    if (!server) {
        setHint(t('connect.need.server'), 'error');
        return false;
    }
    if (!slot) {
        setHint(t('connect.need.slot'), 'error');
        return false;
    }
    if (store.state === CONNECTION_STATE.connecting) {
        setHint(t('connect.already'), 'error');
        return false;
    }
    setHint(t('connect.connecting'));
    dom.connectButton.disabled = true;
    try {
        const result = await store.connect({ server, slot, password });
        const label = t('connect.connected', { slot, game: result.game });
        setHint(label, 'ok');
        consoleUi.write(t('log.connected', { url: server, slot, game: result.game }), 'info');
        if (result.config) {
            consoleUi.write(t('log.config.loaded', {
                pages: result.config.pages,
                perPage: result.config.locationsPerPage,
            }), 'info');
        }
        for (const warning of result.warnings ?? []) {
            consoleUi.write(`slot_data: ${warning}`, 'warn');
        }
        syncModel();
        return true;
    } catch (error) {
        const message = describeLoginError(error, slot);
        setHint(message, 'error');
        consoleUi.write(t('log.login.failed', { error: error?.message ?? error }), 'error');
        return false;
    } finally {
        dom.connectButton.disabled = store.state === CONNECTION_STATE.connected;
        render();
    }
}

function disconnect() {
    store.disconnect();
    setHint(t('status.disconnected'));
    consoleUi.write(t('log.disconnected'), 'info');
    model.clear();
    render();
}

/* ---------------------------------------------------------------- model */

function syncModel({ keepPage = false } = {}) {
    if (!store.isConnected || !store.config) {
        model.clear();
        render();
        return;
    }
    model.setData({
        config: store.config,
        locationIds: store.allLocationIds(),
        checked: store.checkedLocationIds(),
        inflation: store.inflationSteps ?? 0,
        classification: store.scouted,
    });
    if (!keepPage) {
        model.showFirstOpenPage();
    }
    render();
    void scoutStore();
}

/**
 * Asks the server what is in the locations, so the store can label them
 * "Progression", "Useful", "Trap" or "Filler" instead of "Page 1 Location 1".
 * Race seeds refuse this; the labels then fall back to the location number.
 */
async function scoutStore() {
    if (!store.isConnected || !model.hasData) {
        return;
    }
    const ids = [...new Set(model.pages.flatMap((page) => page.slots.map((slot) => slot.id)))];
    const missing = ids.filter((id) => !(id in (store.scouted ?? {})));
    if (missing.length === 0) {
        return;
    }
    await store.scoutLocations(missing);
}

/** Human label for an item classification. */
function kindLabel(kind) {
    const map = {
        progression: t('store.kind.progression'),
        useful: t('store.kind.useful'),
        trap: t('store.kind.trap'),
        filler: t('store.kind.filler'),
        unknown: t('store.kind.unknown'),
    };
    return map[kind] ?? map.unknown;
}

function setStoreMessage(text, kind = '') {
    dom.storeMessage.textContent = text;
    dom.storeMessage.className = `store-message${kind ? ` store-message--${kind}` : ''}`;
}

/* ---------------------------------------------------------------- buttons */

async function buyCurrent() {
    if (!model.hasData) {
        return;
    }
    if (!store.isConnected) {
        setStoreMessage(t('store.not.connected'), 'error');
        return;
    }
    const page = model.currentPage;
    const slot = model.nextFreeSlot();
    if (!slot) {
        setStoreMessage(t('store.soldout'), 'warn');
        return;
    }
    const check = model.canBuy(page.number, store.energy);
    if (!check.ok) {
        setStoreMessage(reasonText(check), 'warn');
        return;
    }
    dom.buyButton.disabled = true;
    setStoreMessage(t('log.buy.start', {
        location: store.locationName(slot.id),
        page: page.number,
        price: formatEnergy(check.price, model.locale),
    }));
    consoleUi.write(t('log.buy.start', {
        location: store.locationName(slot.id),
        page: page.number,
        price: formatEnergy(check.price, model.locale),
    }), 'info');

    const result = await store.buyLocation(slot.id, check.price);
    if (result.ok) {
        model.setChecked([slot.id]);
        model.showFirstOpenPage();
        const text = t('store.purchase.ok', {
            location: store.locationName(slot.id),
            price: formatEnergy(result.price, model.locale),
        });
        setStoreMessage(text, 'ok');
        consoleUi.write(t('log.buy.energylink', {
            amount: formatEnergy(result.charged, model.locale),
            value: formatEnergy(result.energy, model.locale),
        }), 'info');
        consoleUi.write(t('log.buy.done', { location: store.locationName(slot.id) }), 'info');
    } else {
        const reason = reasonText(result);
        setStoreMessage(t('store.purchase.failed', { reason }), 'error');
        consoleUi.write(t('log.buy.error', { error: reason }), 'error');
    }
    render();
}

function reasonText(check) {
    switch (check.reason) {
        case 'insufficient':
            return t('store.too.expensive');
        case 'locked':
            return t('store.need.previous', { page: check.needs ?? check.page - 1 });
        case 'soldout':
            return t('store.soldout');
        case 'already checked':
            return t('store.owned');
        case 'race':
            return t('store.race', { energy: formatEnergy(check.energy ?? 0, model.locale) });
        case 'busy':
            return t('store.purchase.busy');
        case 'not connected':
            return t('store.not.connected');
        case 'error':
            return check.error ?? t('connect.failed');
        default:
            return t('status.unknown');
    }
}

/* ---------------------------------------------------------------- render */

function renderStatus() {
    const connected = store.isConnected;
    dom.statConnection.textContent = connected ? t('status.connected') : t('status.disconnected');
    dom.statConnection.className = `stat-value ${connected ? 'stat-value--on' : 'stat-value--off'}`;

    const energyText = store.energyKnown ? formatEnergy(store.energy, model.locale) : '- J';
    dom.statEnergy.textContent = energyText;
    dom.storeBalance.textContent = energyText;

    dom.statSlot.textContent = connected ? `${store.slotName} (#${store.slot})` : '-';
    dom.statGame.textContent = connected && store.game ? store.game : '-';
    dom.statSeed.textContent = connected ? (store.client.room.seedName || '-') : '-';
    dom.statProgress.textContent = model.hasData
        ? `${formatNumber(model.totalBought, model.locale)} / ${formatNumber(model.totalLocations, model.locale)}`
        : '-';

    const goalTotal = store.config?.mcguffins ?? 0;
    if (connected && goalTotal > 0) {
        const got = store.countItem(store.config?.mcguffinItem ?? 'McGuffin');
        dom.statGoal.textContent = `${formatNumber(got, model.locale)} / ${formatNumber(goalTotal, model.locale)}`;
        dom.statGoal.className = `stat-value ${got >= goalTotal ? 'stat-value--on' : ''}`.trim();
    } else {
        dom.statGoal.textContent = '-';
        dom.statGoal.className = 'stat-value';
    }

    dom.disconnectButton.disabled = !connected && store.state !== CONNECTION_STATE.connecting;
    dom.connectButton.disabled = connected;
}

function renderPageTabs() {
    if (!model.hasData) {
        dom.pageTabs.replaceChildren();
        return;
    }
    const tabs = model.pages.map((page) => {
        const locked = !model.pageUnlocked(page.number);
        const done = page.total > 0 && page.bought >= page.total;
        const item = el('li', {}, [
            el('button', {
                type: 'button',
                class: `page-tabs__tab${page.number === model.page ? ' is-current' : ''}`
                    + `${locked ? ' is-locked' : ''}${done ? ' is-done' : ''}`,
                role: 'tab',
                'aria-selected': page.number === model.page ? 'true' : 'false',
                onclick: () => {
                    model.setPage(page.number);
                    render();
                },
            }, [
                el('span', { class: 'page-tabs__dot' }),
                `${t('store.page.short', { current: page.number })}`,
                done ? ' ✓' : '',
            ]),
        ]);
        return item;
    });
    dom.pageTabs.replaceChildren(...tabs);
}

function renderLocations() {
    if (!model.hasData) {
        dom.locationList.replaceChildren(
            el('p', { class: 'hint', text: store.isConnected ? t('store.no.config') : t('store.not.connected') }),
        );
        return;
    }
    const page = model.currentPage;
    if (!page) {
        dom.locationList.replaceChildren(el('p', { class: 'hint', text: t('store.locations.empty') }));
        return;
    }
    const locked = !model.pageUnlocked(page.number);
    const rows = page.slots.map((slot) => {
        const kind = slot.kind ?? 'unknown';
        const label = kindLabel(kind);
        const tooltip = store.isConnected
            ? `${store.locationName(slot.id)}${store.scoutedNames?.[slot.id] ? ` - ${store.scoutedNames[slot.id]}` : ''}`
            : `Location ${slot.id}`;
        const state = slot.bought
            ? { text: t('store.bought'), cls: 'location__state--bought' }
            : locked
                ? { text: t('store.locked'), cls: '' }
                : { text: t('store.buy'), cls: 'location__state--open' };
        return el('li', { class: `location${slot.bought ? ' location--bought' : ''}${locked && !slot.bought ? ' location--locked' : ''}` }, [
            el('span', { class: 'location__index', text: String(slot.index) }),
            el('span', { class: 'location__name', title: tooltip }, [
                el('span', { class: `location__kind location__kind--${kind}`, text: label }),
            ]),
            el('span', {
                class: 'location__price',
                title: model.inflationSteps > 0 ? t('store.price.inflated') : undefined,
                text: formatEnergy(page.price, model.locale) + (model.inflationSteps > 0 ? ' ↑' : ''),
            }),
            el('span', { class: `location__state ${state.cls}`.trim(), text: state.text }),
        ]);
    });
    if (rows.length === 0) {
        rows.push(el('li', { class: 'hint', text: t('store.locations.empty') }));
    }
    dom.locationList.replaceChildren(...rows);
}

function renderStoreControls() {
    const total = model.pages.length || 0;
    dom.pageIndicator.textContent = total > 0
        ? t('store.page', { current: model.page, total })
        : t('store.page', { current: 0, total: 0 });

    const page = model.currentPage;
    dom.pageSummary.textContent = page
        ? t('store.summary', {
            current: page.number,
            bought: page.bought,
            total: page.total,
        })
        : '';

    dom.prevButton.disabled = !model.hasData || model.page <= 1;
    dom.nextButton.disabled = !model.hasData || model.page >= total;

    if (!model.hasData) {
        dom.buyButton.disabled = true;
        return;
    }
    if (model.allDone) {
        dom.buyButton.disabled = true;
        setStoreMessage(t('store.all.done'), 'ok');
        return;
    }
    const check = model.canBuy(model.page, store.energy);
    dom.buyButton.disabled = !check.ok || store.buying;
    dom.buyButton.textContent = check.ok
        ? `${t('store.buy')} · ${formatEnergy(check.price, model.locale)}`
        : t('store.buy');
    if (!check.ok && store.isConnected) {
        setStoreMessage(reasonText(check), check.reason === 'insufficient' ? 'warn' : '');
    }
}

function render() {
    renderStatus();
    renderPageTabs();
    renderLocations();
    renderStoreControls();
}

/* ---------------------------------------------------------------- console */

function buildConsole() {
    consoleUi = new Console(document.getElementById('console-panel'), {
        help: () => consoleUi.printHelp(),
        clear: () => {
            consoleUi.clear();
            return '';
        },
        connect: async (args) => {
            const [server, slot, ...rest] = args;
            if (!server || !slot) {
                return t('console.bad.args');
            }
            dom.serverInput.value = server;
            dom.slotInput.value = slot;
            dom.passwordInput.value = rest.join(' ') ?? '';
            const ok = await doConnect({ server, slot, password: rest.join(' ') });
            return ok ? t('connect.connected', { slot, game: store.game }) : '';
        },
        disconnect: () => {
            disconnect();
            return t('log.disconnected');
        },
        status: () => {
            const lines = [
                `${t('status.connection')}: ${store.isConnected ? t('status.connected') : t('status.disconnected')}`,
                `${t('status.slot')}: ${store.isConnected ? `${store.slotName} (#${store.slot}, team ${store.team})` : '-'}`,
                `${t('status.game')}: ${store.game || '-'}`,
                `${t('status.energy')}: ${store.energyKnown ? formatEnergy(store.energy, model.locale) : '-'}`,
                `${t('status.progress')}: ${model.hasData ? `${model.totalBought}/${model.totalLocations}` : '-'}`,
                `${t('status.goal')}: ${store.config?.mcguffins
                    ? `${store.countItem(store.config.mcguffinItem ?? 'McGuffin')}/${store.config.mcguffins}`
                    : '-'}`,
                t('console.traps', {
                    tax: store.trapEffects?.tax ?? 0,
                    inflation: store.trapEffects?.inflation ?? 0,
                    factor: store.inflationFactor.toFixed(2),
                }),
            ];
            return lines.join('\n');
        },
        balance: async () => {
            if (!store.isConnected) {
                return t('console.need.connection');
            }
            const value = await store.refreshEnergy(true);
            return `${t('status.energy')}: ${formatEnergy(value, model.locale)}`;
        },
        refresh: async () => {
            if (!store.isConnected) {
                return t('console.need.connection');
            }
            const value = await store.refreshEnergy(true);
            return t('log.energylink', { value: formatEnergy(value, model.locale) });
        },
        page: (args) => {
            const number = Number.parseInt(args[0] ?? '', 10);
            if (!Number.isFinite(number) || !model.hasData) {
                return t('console.bad.args');
            }
            model.setPage(number);
            render();
            return t('store.page.short', { current: model.page });
        },
        pages: () => {
            if (!model.hasData) {
                return t('error.no.store');
            }
            return model.pages
                .map((page) => {
                    const locked = !model.pageUnlocked(page.number);
                    return `${page.number}: ${page.bought}/${page.total} · ${formatEnergy(page.price, model.locale)}`
                        + `${locked ? ' (locked)' : ''}`;
                })
                .join('\n');
        },
        locations: () => {
            if (!model.hasData) {
                return t('error.no.store');
            }
            const page = model.currentPage;
            return page.slots
                .map((slot) => `${slot.index}. ${kindLabel(slot.kind)}`
                    + ` (${store.locationName(slot.id)})`
                    + ` - ${slot.bought ? t('store.bought') : formatEnergy(page.price, model.locale)}`)
                .join('\n');
        },
        buy: async (args) => {
            if (!store.isConnected || !model.hasData) {
                return t('console.need.connection');
            }
            const position = Number.parseInt(args[0] ?? '', 10);
            if (Number.isFinite(position)) {
                const slot = model.locationAt(position);
                if (!slot) {
                    return t('console.bad.args');
                }
                if (slot.bought) {
                    return t('store.owned');
                }
                const check = model.canBuy(model.page, store.energy);
                if (!check.ok) {
                    return reasonText(check);
                }
                const result = await store.buyLocation(slot.id, check.price);
                if (result.ok) {
                    model.setChecked([slot.id]);
                    model.showFirstOpenPage();
                    render();
                    return t('store.purchase.ok', {
                        location: store.locationName(slot.id),
                        price: formatEnergy(check.price, model.locale),
                    });
                }
                return t('store.purchase.failed', { reason: reasonText(result) });
            }
            await buyCurrent();
            return '';
        },
        lang: async (args) => {
            const code = args[0];
            if (!code) {
                return t('console.bad.args');
            }
            if (!LANGUAGES.some((lang) => lang.code.toLowerCase() === code.toLowerCase())) {
                return t('console.lang.unknown', { code, list: consoleUi.languageList() });
            }
            const match = LANGUAGES.find((lang) => lang.code.toLowerCase() === code.toLowerCase());
            await changeLanguage(match.code);
            return t('console.lang.changed', { code: match.code });
        },
        say: async (args) => {
            if (!store.isConnected) {
                return t('console.need.connection');
            }
            const text = args.join(' ');
            if (!text) {
                return t('console.bad.args');
            }
            await store.say(text);
            return '';
        },
    });
}

/* ---------------------------------------------------------------- events */

function bindStoreEvents() {
    store.addEventListener('state', (event) => {
        const detail = event.detail ?? {};
        if (detail.state === CONNECTION_STATE.connected) {
            syncModel();
        } else if (detail.state === CONNECTION_STATE.disconnected) {
            render();
        }
    });
    store.addEventListener('energy', (event) => {
        const detail = event.detail ?? {};
        if (detail.value === null) {
            consoleUi?.write(t('log.energylink.unavailable', { error: detail.error?.message ?? 'unknown' }), 'warn');
            return;
        }
        if (detail.first) {
            consoleUi?.write(t('log.energylink', { value: formatEnergy(detail.value, model.locale) }), 'info');
        } else if (detail.old !== detail.value) {
            consoleUi?.write(t('log.energylink.change', {
                old: formatEnergy(detail.old, model.locale),
                value: formatEnergy(detail.value, model.locale),
            }), 'info');
        }
        render();
    });
    store.addEventListener('locations', () => {
        if (!store.isConnected) {
            return;
        }
        model.setChecked([...store.checkedLocationIds()]);
        render();
    });
    store.addEventListener('disconnected', () => {
        setHint(t('connect.lost'), 'error');
        consoleUi?.write(t('connect.lost'), 'warn');
        model.clear();
        render();
    });
    store.addEventListener('items', (event) => {
        const detail = event.detail ?? {};
        const total = store.config?.mcguffins ?? 0;
        const got = detail.mcguffins ?? 0;
        if (detail.last?.length) {
            const mc = detail.last.filter((name) => name === (store.config?.mcguffinItem ?? 'McGuffin')).length;
            if (mc > 0) {
                consoleUi?.write(t('log.items.mcguffin', { count: mc, got, total }), 'info');
            }
            for (const name of detail.last) {
                if (name === 'Tax Trap' || name === 'Inflation Trap') {
                    consoleUi?.write(t('log.items.trap', { trap: name }), 'warn');
                }
            }
        }
        // an inflation trap changes the prices of the open pages
        model.setInflation(store.inflationSteps);
        render();
    });
    store.addEventListener('trap', (event) => {
        const detail = event.detail ?? {};
        if (detail.kind === 'tax') {
            consoleUi?.write(t('log.trap.tax', {
                amount: formatEnergy(detail.amount, model.locale),
                value: formatEnergy(detail.energy, model.locale),
            }), 'error');
        }
        render();
    });
    store.addEventListener('scouted', (event) => {
        const detail = event.detail ?? {};
        model.setClassification(detail.classification ?? {});
        consoleUi?.write(t('log.scouted', { count: detail.count ?? 0 }), 'info');
        render();
    });
    store.addEventListener('datapackage', (event) => {
        consoleUi?.write(t('log.datapackage', { games: `${event.detail.game} (${event.detail.locations})` }), 'info');
        syncModel();
    });
    store.addEventListener('log', (event) => {
        const { level, message } = event.detail ?? {};
        if (level === 'chat') {
            consoleUi?.write(t('log.chat', { text: message }), 'chat');
            return;
        }
        consoleUi?.write(message, level ?? 'info');
    });
    model.addEventListener('change', () => render());
}

function bindUiEvents() {
    dom.connectForm.addEventListener('submit', (event) => {
        event.preventDefault();
        void doConnect({
            server: dom.serverInput.value.trim(),
            slot: dom.slotInput.value.trim(),
            password: dom.passwordInput.value,
        });
    });
    dom.disconnectButton.addEventListener('click', () => disconnect());
    dom.buyButton.addEventListener('click', () => void buyCurrent());
    dom.prevButton.addEventListener('click', () => {
        model.previousPage();
        render();
    });
    dom.nextButton.addEventListener('click', () => {
        model.nextPage();
        render();
    });
    dom.languageSelect.addEventListener('change', (event) => {
        void changeLanguage(event.target.value);
    });
    window.addEventListener('beforeunload', () => store.disconnect());
}

/* ---------------------------------------------------------------- boot */

async function boot() {
    fillLanguageSelect();
    await initI18n(getLanguage());
    model.setLanguage(getLanguage());
    document.documentElement.lang = getLanguage().replace('_', '-');
    applyTranslations();
    fillLanguageSelect();

    buildConsole();
    bindStoreEvents();
    bindUiEvents();

    const stored = {
        server: localStorage.getItem('ap-store.server') ?? '',
        slot: localStorage.getItem('ap-store.slot') ?? '',
    };
    dom.serverInput.value = stored.server;
    dom.slotInput.value = stored.slot;
    dom.connectForm.addEventListener('submit', () => {
        localStorage.setItem('ap-store.server', dom.serverInput.value.trim());
        localStorage.setItem('ap-store.slot', dom.slotInput.value.trim());
    });

    consoleUi.write(t('console.welcome'), 'info');
    render();
}

void boot();

// Exposed for tests and for use from the browser dev console.
window.energylinkStore = { store, model, console: () => consoleUi, t };

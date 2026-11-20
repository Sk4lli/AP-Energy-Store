// Store configuration, taken from the slot_data the server sends on login.
//
// Contract with the APWorld (keys in slot_data, all optional):
//   progress_items      number of progress pages         (default 5)
//   locations_per_page  locations per page, 5..10        (default 5)
//   base_price          price of a page 1 location in J  (default 1e6)
//   price_step          added to the price per page      (default 1e6)
//   energylink_key      override for the EnergyLink key  (default EnergyLink{team})
//
// Aliases are accepted so a YAML option named slightly differently still works.

import { clamp, toInt, toFloat } from './util.js';

export const LIMITS = {
    pages: { min: 1, max: 50, fallback: 5 },
    perPage: { min: 5, max: 10, fallback: 5 },
    basePrice: { fallback: 1e6 },
    priceStep: { fallback: 1e6 },
};

const ALIASES = {
    progressItems: ['progress_items', 'progressItems', 'progress_item_count', 'progressitems'],
    locationsPerPage: [
        'locations_per_page', 'locationsPerPage',
        'locations_per_progress', 'locationsPerProgress',
        'locations_per_item', 'locationsPerItem',
    ],
    basePrice: ['base_price', 'basePrice', 'price_base', 'starting_price'],
    priceStep: ['price_step', 'priceStep', 'price_increase', 'price_per_page'],
    energyLinkKey: ['energylink_key', 'energy_link_key', 'energylinkKey'],
    mcguffins: ['mcguffins_required', 'mcguffin_count', 'goal_items', 'mcguffins'],
    mcguffinItem: ['mcguffin_name', 'mcguffin_item', 'goal_item_name'],
    fillerJoules: ['filler_joules', 'filler_value', 'filler_joule'],
    taxPerTrap: ['tax_per_trap', 'trap_tax', 'tax_amount'],
    inflationPerTrap: ['inflation_per_trap', 'trap_inflation', 'inflation_amount'],
};

function pick(source, names) {
    for (const name of names) {
        if (source && source[name] !== undefined && source[name] !== null && source[name] !== '') {
            return source[name];
        }
    }
    return undefined;
}

export function defaultConfig() {
    return {
        pages: LIMITS.pages.fallback,
        locationsPerPage: LIMITS.perPage.fallback,
        basePrice: LIMITS.basePrice.fallback,
        priceStep: LIMITS.priceStep.fallback,
        energyLinkKey: null,
        mcguffins: 0,
        mcguffinItem: 'McGuffin',
        fillerJoules: 0,
        taxPerTrap: 0,
        inflationPerTrap: 0,
        source: 'default',
    };
}

/**
 * Builds the store configuration from slot_data.
 * Returns { config, warnings } - warnings are shown in the console, not thrown.
 */
export function parseConfig(slotData, { game, team } = {}) {
    const warnings = [];
    const config = defaultConfig();

    if (!slotData || typeof slotData !== 'object' || Object.keys(slotData).length === 0) {
        warnings.push('slot_data is empty, using defaults');
        config.source = 'default';
        return { config, warnings };
    }

    // Some worlds nest their own options under a single key.
    const nested = slotData.energylink_store ?? slotData.store ?? slotData.config ?? null;
    const source = nested && typeof nested === 'object' ? { ...slotData, ...nested } : slotData;

    const pages = pick(source, ALIASES.progressItems);
    if (pages !== undefined) {
        const parsed = toInt(pages, LIMITS.pages.fallback);
        config.pages = clamp(parsed, LIMITS.pages.min, LIMITS.pages.max);
        if (config.pages !== parsed) {
            warnings.push(`progress_items ${parsed} clamped to ${config.pages}`);
        }
        config.source = 'slot_data';
    }

    const perPage = pick(source, ALIASES.locationsPerPage);
    if (perPage !== undefined) {
        const parsed = toInt(perPage, LIMITS.perPage.fallback);
        config.locationsPerPage = clamp(parsed, LIMITS.perPage.min, LIMITS.perPage.max);
        if (config.locationsPerPage !== parsed) {
            warnings.push(`locations_per_page ${parsed} clamped to ${config.locationsPerPage} (allowed 5..10)`);
        }
        config.source = 'slot_data';
    }

    const basePrice = pick(source, ALIASES.basePrice);
    if (basePrice !== undefined) {
        const parsed = toFloat(basePrice, LIMITS.basePrice.fallback);
        config.basePrice = Math.max(0, Math.round(parsed));
        config.source = 'slot_data';
    }

    const priceStep = pick(source, ALIASES.priceStep);
    if (priceStep !== undefined) {
        const parsed = toFloat(priceStep, LIMITS.priceStep.fallback);
        config.priceStep = Math.round(parsed);
        config.source = 'slot_data';
    }

    const mcguffins = pick(source, ALIASES.mcguffins);
    if (mcguffins !== undefined) {
        config.mcguffins = Math.max(0, toInt(mcguffins, 0));
        config.source = 'slot_data';
    }

    const mcguffinItem = pick(source, ALIASES.mcguffinItem);
    if (typeof mcguffinItem === 'string' && mcguffinItem.trim() !== '') {
        config.mcguffinItem = mcguffinItem.trim();
    }

    const fillerJoules = pick(source, ALIASES.fillerJoules);
    if (fillerJoules !== undefined) {
        config.fillerJoules = Math.max(0, Math.round(toFloat(fillerJoules, 0)));
    }

    const taxPerTrap = pick(source, ALIASES.taxPerTrap);
    if (taxPerTrap !== undefined) {
        config.taxPerTrap = Math.max(0, Math.round(toFloat(taxPerTrap, 0)));
    }

    const inflationPerTrap = pick(source, ALIASES.inflationPerTrap);
    if (inflationPerTrap !== undefined) {
        // 0.25 means "25% more expensive per trap"
        config.inflationPerTrap = Math.max(0, toFloat(inflationPerTrap, 0));
    }

    const key = pick(source, ALIASES.energyLinkKey);
    if (typeof key === 'string' && key.trim() !== '') {
        config.energyLinkKey = key.trim();
        config.source = 'slot_data';
    } else if (team !== undefined && team !== null && team !== '' && Number.isFinite(Number(team)) && Number(team) >= 0) {
        // Same key the Factorio client uses: EnergyLink<team> (team is 0-based here).
        config.energyLinkKey = `EnergyLink${Number(team)}`;
    }

    if (config.source === 'default') {
        warnings.push('no store options found in slot_data, using defaults');
    }
    if (game) {
        config.game = game;
    }
    return { config, warnings };
}

/** Price of a location: every location of a page costs the same, pages get more expensive. */
export function priceFor(config, pageNumber) {
    const index = Math.max(0, Number(pageNumber) - 1);
    return Math.round(config.basePrice + config.priceStep * index);
}

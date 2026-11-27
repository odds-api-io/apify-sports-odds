import { Actor, log } from 'apify';

const BASE_URL = 'https://api.odds-api.io/v3';
const MULTI_BATCH_SIZE = 10;
const CLOSING_LINES_PAGE = 100;
const CLOSING_LINES_MAX_LEAGUES = 10;
const DEFAULT_CLOSING_MARKETS = ['ML', 'Spread', 'Totals'];
const NON_PRICE_KEYS = new Set(['hdp', 'max', 'label']);

class ApiError extends Error {}

const chunk = (items, size) => {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
};

const cleanList = (value) => {
    const items = Array.isArray(value) ? value : String(value || '').split(',');
    return [...new Set(items.map((s) => String(s).trim()).filter(Boolean))];
};

const toNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

async function apiGet(path, params, apiKey) {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    url.searchParams.set('apiKey', apiKey);

    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) return res.json();

    let detail = '';
    try {
        const body = await res.json();
        detail = body?.error || body?.message || '';
    } catch {
        detail = '';
    }
    const suffix = detail ? ` (${detail})` : '';

    switch (res.status) {
        case 401:
            throw new ApiError(`Invalid or missing Odds-API.io API key${suffix}. Check the apiKey input or get a key at https://odds-api.io/pricing`);
        case 403:
            throw new ApiError(`Your Odds-API.io plan does not cover this request${suffix}. Check that the bookmakers are selected on your plan.`);
        case 429:
            throw new ApiError(`Odds-API.io rate limit reached${suffix}. Try again after ${res.headers.get('x-ratelimit-reset') || 'the limit resets'}.`);
        case 400:
            throw new ApiError(`Odds-API.io rejected the request parameters${suffix}.`);
        case 404:
            throw new ApiError(`Not found on Odds-API.io: ${path}${suffix}.`);
        default:
            throw new ApiError(`Odds-API.io returned HTTP ${res.status}${suffix}.`);
    }
}

async function listEvents(input) {
    if (input.eventIds.length) {
        const events = [];
        for (const id of input.eventIds) events.push(await apiGet(`/events/${encodeURIComponent(id)}`, {}, input.apiKey));
        return events;
    }
    const events = await apiGet('/events', {
        sport: input.sport,
        league: input.league,
        status: input.status,
        limit: input.maxEvents,
    }, input.apiKey);
    return events.slice(0, input.maxEvents);
}

function selectionRows(event, bookmaker, market, closingLine) {
    const base = {
        eventId: event.id,
        sport: event.sport?.slug ?? event.sport ?? null,
        sportName: event.sport?.name ?? null,
        league: event.league?.slug ?? event.league ?? null,
        leagueName: event.league?.name ?? null,
        home: event.home ?? null,
        away: event.away ?? null,
        homeId: event.homeId ?? null,
        awayId: event.awayId ?? null,
        startTime: event.date ?? null,
        status: event.status ?? null,
        bookmaker,
        market: market.name,
        closingLine,
        updatedAt: market.updatedAt ?? null,
        bookmakerUrl: event.urls?.[bookmaker] ?? null,
    };

    const rows = [];
    for (const entry of market.odds || []) {
        const label = entry.label ?? null;
        const line = toNumber(entry.hdp ?? entry.max);
        for (const [key, value] of Object.entries(entry)) {
            if (NON_PRICE_KEYS.has(key)) continue;
            const price = toNumber(value);
            if (price === null) continue;
            rows.push({
                ...base,
                label,
                line,
                selection: key === 'odds' ? (label ?? 'odds') : key,
                price,
            });
        }
    }
    return rows;
}

function eventRows(event, closingLine) {
    const rows = [];
    for (const [bookmaker, markets] of Object.entries(event.bookmakers || {})) {
        for (const market of markets) rows.push(...selectionRows(event, bookmaker, market, closingLine));
    }
    return rows;
}

async function saveCurrentOdds(input, events) {
    let rows = 0;
    for (const batch of chunk(events.map((e) => e.id), MULTI_BATCH_SIZE)) {
        const withOdds = await apiGet('/odds/multi', {
            eventIds: batch.join(','),
            bookmakers: input.bookmakers.join(','),
            markets: input.markets.join(','),
        }, input.apiKey);
        const out = withOdds.flatMap((e) => eventRows(e, false));
        if (out.length) await Actor.pushData(out);
        rows += out.length;
    }
    return rows;
}

async function saveClosingLines(input, events) {
    const leagues = input.league
        ? [input.league]
        : cleanList(events.map((e) => e.league?.slug ?? e.league)).slice(0, CLOSING_LINES_MAX_LEAGUES);
    if (!leagues.length) {
        log.warning('Closing lines skipped: no league given and no events to take leagues from.');
        return 0;
    }

    const to = new Date();
    const from = new Date(to.getTime() - input.closingLinesDays * 86_400_000);
    const markets = input.markets.length ? input.markets : DEFAULT_CLOSING_MARKETS;
    let rows = 0;
    let eventsSeen = 0;

    for (let skip = 0; eventsSeen < input.maxEvents; skip += CLOSING_LINES_PAGE) {
        let page;
        try {
            page = await apiGet('/historical/closing-lines', {
                sport: input.sport,
                leagues: leagues.join(','),
                from: from.toISOString(),
                to: to.toISOString(),
                markets: markets.join(','),
                bookmakers: input.bookmakers.join(','),
                limit: Math.min(CLOSING_LINES_PAGE, input.maxEvents - eventsSeen),
                skip,
            }, input.apiKey);
        } catch (err) {
            if (err instanceof ApiError) {
                log.warning(`Closing lines skipped: ${err.message}`);
                return rows;
            }
            throw err;
        }
        if (!page.length) break;
        eventsSeen += page.length;
        const out = page.flatMap((e) => eventRows(e, true));
        if (out.length) await Actor.pushData(out);
        rows += out.length;
        if (page.length < CLOSING_LINES_PAGE) break;
    }
    return rows;
}

const eventRow = (e) => ({
    id: e.id,
    sport: e.sport?.slug ?? e.sport,
    league: e.league?.slug ?? e.league,
    leagueName: e.league?.name,
    home: e.home,
    away: e.away,
    homeId: e.homeId,
    awayId: e.awayId,
    date: e.date,
    status: e.status,
    scores: e.scores,
    clock: e.clock,
    esports: e.esports,
});

async function runEvents(input) {
    const events = await listEvents(input);
    await Actor.pushData(events.map(eventRow));
    return events.length;
}

async function runOdds(input) {
    const ids = input.eventIds.length
        ? input.eventIds
        : (await listEvents(input)).map((e) => e.id);
    if (!ids.length) return 0;

    let rows = 0;
    for (const batch of chunk(ids, MULTI_BATCH_SIZE)) {
        const events = await apiGet('/odds/multi', {
            eventIds: batch.join(','),
            bookmakers: input.bookmakers.join(','),
            markets: input.markets.join(','),
        }, input.apiKey);

        const out = [];
        for (const e of events) {
            for (const [bookmaker, markets] of Object.entries(e.bookmakers || {})) {
                for (const market of markets) {
                    out.push({
                        eventId: e.id,
                        sport: e.sport?.slug ?? e.sport,
                        league: e.league?.slug ?? e.league,
                        home: e.home,
                        away: e.away,
                        date: e.date,
                        status: e.status,
                        bookmaker,
                        market: market.name,
                        updatedAt: market.updatedAt,
                        odds: market.odds,
                        url: e.urls?.[bookmaker],
                    });
                }
            }
        }
        await Actor.pushData(out);
        rows += out.length;
    }
    return rows;
}

async function runValueBets(input) {
    let rows = 0;
    for (const bookmaker of input.bookmakers) {
        const bets = await apiGet('/value-bets', {
            bookmaker,
            sport: input.sport,
            league: input.league,
            includeEventDetails: true,
        }, input.apiKey);
        await Actor.pushData(bets.map((b) => ({ ...b, bookmaker: b.bookmaker || bookmaker })));
        rows += bets.length;
    }
    return rows;
}

async function runRows(input) {
    const events = await listEvents(input);
    log.info(`Found ${events.length} events.`);
    const currentRows = events.length ? await saveCurrentOdds(input, events) : 0;
    log.info(`Saved ${currentRows} current odds rows.`);

    let closingRows = 0;
    if (input.includeClosingLines) {
        closingRows = await saveClosingLines(input, events);
        log.info(`Saved ${closingRows} closing line rows from the last ${input.closingLinesDays} days.`);
    }
    return currentRows + closingRows;
}

const MODES = { rows: runRows, events: runEvents, odds: runOdds, valueBets: runValueBets };

const EXAMPLE_ROWS = [
    { example: true, eventId: 0, sport: 'football', league: 'england-premier-league', home: 'Home Team', away: 'Away Team', startTime: '2026-01-01T15:00:00Z', status: 'pending', bookmaker: 'Bet365', market: 'ML', label: null, line: null, selection: 'home', price: 2.1, closingLine: false, updatedAt: '2026-01-01T10:00:00Z', note: 'Example row. Add your Odds-API.io apiKey for live data.' },
    { example: true, eventId: 0, sport: 'football', league: 'england-premier-league', home: 'Home Team', away: 'Away Team', startTime: '2026-01-01T15:00:00Z', status: 'pending', bookmaker: 'Bet365', market: 'ML', label: null, line: null, selection: 'draw', price: 3.4, closingLine: false, updatedAt: '2026-01-01T10:00:00Z', note: 'Example row. Add your Odds-API.io apiKey for live data.' },
    { example: true, eventId: 0, sport: 'football', league: 'england-premier-league', home: 'Home Team', away: 'Away Team', startTime: '2026-01-01T15:00:00Z', status: 'pending', bookmaker: 'Bet365', market: 'ML', label: null, line: null, selection: 'away', price: 3.6, closingLine: false, updatedAt: '2026-01-01T10:00:00Z', note: 'Example row. Add your Odds-API.io apiKey for live data.' },
];

await Actor.init();

try {
    const raw = (await Actor.getInput()) || {};
    const input = {
        apiKey: String(raw.apiKey || '').trim(),
        mode: String(raw.mode || 'rows').trim(),
        sport: String(raw.sport || 'football').trim(),
        league: String(raw.league || '').trim(),
        bookmakers: cleanList(raw.bookmakers),
        markets: cleanList(raw.markets),
        eventIds: cleanList(raw.eventIds),
        status: String(raw.status || 'pending').trim(),
        includeClosingLines: raw.includeClosingLines === true,
        closingLinesDays: Number.isInteger(raw.closingLinesDays) && raw.closingLinesDays > 0 ? Math.min(raw.closingLinesDays, 366) : 7,
        maxEvents: Number.isInteger(raw.maxEvents) && raw.maxEvents > 0 ? raw.maxEvents : 20,
    };

    if (!input.apiKey) {
        log.warning('No apiKey given, so this run saves example rows only. Add your Odds-API.io key (https://odds-api.io/pricing) to get live data.');
        await Actor.pushData(EXAMPLE_ROWS);
        await Actor.exit('Saved example rows. Add an apiKey to fetch live data.');
    }
    if (!MODES[input.mode]) throw new ApiError(`Unknown mode "${input.mode}". Use rows, events, odds or valueBets.`);
    if (input.mode !== 'events' && !input.bookmakers.length) throw new ApiError(`The bookmakers input is required for ${input.mode} mode, for example "Bet365,Unibet". Use bookmakers selected on your plan.`);

    log.info(`Running ${input.mode} mode for ${input.status} ${input.sport}${input.league ? `/${input.league}` : ''}${input.bookmakers.length ? ` from ${input.bookmakers.join(', ')}` : ''}${input.mode === 'events' ? '' : (input.markets.length ? ` for ${input.markets.join(', ')}` : ' for all markets')}`);

    const count = await MODES[input.mode](input);
    log.info(`Saved ${count} rows to the dataset.`);
    await Actor.exit(`Saved ${count} rows.`);
} catch (err) {
    if (err instanceof ApiError) await Actor.fail(err.message);
    else await Actor.fail(`Unexpected error: ${err.message}`);
}

import { Actor, log } from 'apify';

const BASE_URL = 'https://api.odds-api.io/v3';
const MULTI_BATCH_SIZE = 10;

class ApiError extends Error {}

const splitList = (value) => (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const chunk = (items, size) => {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
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
            throw new ApiError(`Your Odds-API.io plan does not have access to this request${suffix}. Check that the bookmakers are selected on your plan.`);
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

await Actor.init();

try {
    const raw = (await Actor.getInput()) || {};
    const input = {
        apiKey: (raw.apiKey || '').trim(),
        mode: raw.mode || 'events',
        sport: (raw.sport || 'football').trim(),
        league: (raw.league || '').trim(),
        bookmakers: splitList(raw.bookmakers),
        markets: splitList(raw.markets),
        eventIds: (raw.eventIds || []).map((id) => String(id).trim()).filter(Boolean),
        status: (raw.status || 'pending').trim(),
        maxEvents: Number.isInteger(raw.maxEvents) && raw.maxEvents > 0 ? raw.maxEvents : 20,
    };

    if (!input.apiKey) throw new ApiError('The apiKey input is required. Get an Odds-API.io key at https://odds-api.io/pricing');
    if (!['events', 'odds', 'valueBets'].includes(input.mode)) throw new ApiError(`Unknown mode "${input.mode}". Use events, odds or valueBets.`);
    if (input.mode !== 'events' && !input.bookmakers.length) throw new ApiError(`The bookmakers input is required for ${input.mode} mode, for example "Bet365,Unibet".`);

    log.info(`Running ${input.mode} mode for ${input.sport}${input.league ? `/${input.league}` : ''}`);

    const runners = { events: runEvents, odds: runOdds, valueBets: runValueBets };
    const count = await runners[input.mode](input);

    log.info(`Saved ${count} rows to the dataset.`);
    await Actor.exit(`Saved ${count} rows.`);
} catch (err) {
    if (err instanceof ApiError) await Actor.fail(err.message);
    else await Actor.fail(`Unexpected error: ${err.message}`);
}

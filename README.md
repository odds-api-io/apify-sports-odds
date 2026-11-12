# Odds-API.io Sports Odds

Pull sports events, bookmaker odds and value bets from [Odds-API.io](https://odds-api.io) into an Apify dataset. Odds-API.io covers 450+ bookmakers across 34 sports, pre-match and in-play, with fast real-time updates.

Export the results as JSON, CSV or Excel, schedule runs, or connect them to Google Sheets, Make, Zapier and webhooks through Apify integrations.

## What it does

The Actor has three modes:

- **events**: lists fixtures for a sport and league, with kickoff time, status and scores. One row per event.
- **odds**: fetches odds for those events from the bookmakers you choose. One row per event, bookmaker and market (ML, Spread, Totals and many more).
- **valueBets**: returns pre-match prices above a fair-odds estimate for each bookmaker you choose. One row per value bet.

## Pricing

The Actor itself is free to run. You bring your own Odds-API.io API key, and requests count against your Odds-API.io plan.

**Get an API key: https://odds-api.io/pricing**

## Input

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `apiKey` | string (secret) | no | | Your Odds-API.io API key. Without it the run saves two example rows. |
| `mode` | `events`, `odds` or `valueBets` | yes | `events` | What to fetch. |
| `sport` | string | no | `football` | Sport slug, for example `football`, `basketball`, `tennis`, `esports`. |
| `league` | string | no | | League slug, for example `england-premier-league`. |
| `bookmakers` | string | for `odds` and `valueBets` | | Comma-separated bookmaker names, for example `Bet365,Unibet`. Use bookmakers selected on your plan. |
| `markets` | string | no | | Comma-separated market names for `odds` mode, for example `ML,Spread,Totals`. All markets when empty. |
| `eventIds` | array of strings | no | | Fetch these events directly instead of listing by sport and league (`events` and `odds` modes). |
| `status` | string | no | `pending` | Event status filter: `pending`, `live`, `settled`, `cancelled`, or a comma-separated list. |
| `maxEvents` | integer | no | `20` | Maximum number of events to list in `events` and `odds` modes. |

Example input:

```json
{
    "apiKey": "YOUR_API_KEY",
    "mode": "odds",
    "sport": "football",
    "league": "england-premier-league",
    "bookmakers": "Bet365,Unibet",
    "markets": "ML,Totals",
    "maxEvents": 10
}
```

Odds are fetched with `/odds/multi`, 10 events per request, so a run with 20 events uses 1 request to list the events and 2 requests for the odds.

## Output

### events

```json
{
    "id": 123456,
    "sport": "football",
    "league": "england-premier-league",
    "leagueName": "England - Premier League",
    "home": "Manchester United",
    "away": "Liverpool",
    "homeId": 38,
    "awayId": 42,
    "date": "2026-11-22T15:00:00Z",
    "status": "pending"
}
```

### odds

```json
{
    "eventId": 123456,
    "sport": "football",
    "league": "england-premier-league",
    "home": "Manchester United",
    "away": "Liverpool",
    "date": "2026-11-22T15:00:00Z",
    "status": "pending",
    "bookmaker": "Bet365",
    "market": "ML",
    "updatedAt": "2026-11-20T10:30:00Z",
    "odds": [{ "home": "2.10", "draw": "3.40", "away": "3.20" }],
    "url": "https://www.bet365.com/..."
}
```

### valueBets

```json
{
    "id": "vb_123456_bet365_home",
    "eventId": 123456,
    "bookmaker": "Bet365",
    "market": { "name": "ML", "home": "2.03", "draw": "3.80", "away": "4.00" },
    "betSide": "home",
    "expectedValue": 103.45,
    "bookmakerOdds": { "home": "2.10", "draw": "3.40", "away": "3.20" },
    "event": {
        "home": "Manchester United",
        "away": "Liverpool",
        "date": "2026-11-22T15:00:00Z",
        "sport": "Football",
        "league": "England - Premier League"
    }
}
```

`expectedValue` is bookmaker odds divided by fair odds, times 100. A value of 103.45 means the price is 3.45% above the fair estimate.

## Errors

The run fails with a clear status message when:

- the API key is missing or invalid (HTTP 401),
- your plan does not cover the request, for example a bookmaker not selected on your plan (HTTP 403),
- the hourly rate limit is reached (HTTP 429).

## Run locally

```bash
npm install
mkdir -p storage/key_value_stores/default
echo '{"apiKey":"YOUR_API_KEY","mode":"events","sport":"football"}' > storage/key_value_stores/default/INPUT.json
npm start
```

Results are written to `storage/datasets/default`.

## Links

- Odds-API.io: https://odds-api.io
- API documentation: https://docs.odds-api.io
- Pricing and API keys: https://odds-api.io/pricing

## License

MIT

# Odds-API.io Sports Odds: 500+ Bookmakers

Official Apify Actor for [Odds-API.io](https://odds-api.io), a sports odds API covering 500+ bookmakers across 37 sports over REST and WebSocket, with historical odds and closing lines. You need an Odds-API.io key (a time-limited test key is available on request from the site). The Actor writes one row per event, bookmaker, market and selection to the default dataset. SDKs for Python, Node, Go, PHP and R, an MCP server and a Google Sheets add-on are listed in the [docs](https://docs.odds-api.io).

Export the rows as JSON, CSV or Excel, schedule runs, or send them on to Google Sheets, Make, Zapier, webhooks or your own code through Apify integrations.

## What it does

1. Lists pre-match or live events for a sport, optionally one league (or takes the event IDs you give it).
2. Fetches odds for those events from the bookmakers and markets you pick: moneyline (`ML`), `Spread`, `Totals`, `Player Props`, `Both Teams To Score`, `Correct Score` and every other market the bookmaker carries.
3. Optionally adds the closing lines of events that finished in the last N days for the same leagues, bookmakers and markets.
4. Writes one dataset row per event, bookmaker, market and selection, with the price, line, label and the time the bookmaker market was last written.

## Pricing

The Actor is free to run. You bring your own Odds-API.io key and requests count against your Odds-API.io plan.

**Get a key: https://odds-api.io/pricing**

## Input

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `apiKey` | string (secret) | | Your Odds-API.io API key. Without it the run saves three example rows. |
| `sport` | string | `football` | Sport slug, for example `football`, `basketball`, `tennis`, `ice-hockey`, `esports`. Full list: `GET https://api.odds-api.io/v3/sports`. |
| `league` | string | | Optional league slug, for example `england-premier-league` or `usa-nba`. |
| `bookmakers` | array of strings | | Bookmaker names as listed by `GET https://api.odds-api.io/v3/bookmakers`, for example `["Bet365", "Unibet"]`. Required. Use bookmakers selected on your plan. |
| `markets` | array of strings | `["ML", "Spread", "Totals"]` | Market names. Empty means every market the bookmaker offers for the event. |
| `status` | `pending`, `live` or `pending,live` | `pending` | Pre-match, in-play or both. |
| `includeClosingLines` | boolean | `false` | Also save closing odds for events that finished in the last `closingLinesDays` days. Paid Odds-API.io plans only. |
| `closingLinesDays` | integer | `7` | Window for closing lines, 1 to 366 days. |
| `maxEvents` | integer | `20` | Maximum events to fetch odds for. Also caps the settled events used for closing lines. |
| `eventIds` | array of strings | | Fetch exactly these Odds-API.io event IDs instead of listing by sport, league and status. |

Example input:

```json
{
    "apiKey": "YOUR_API_KEY",
    "sport": "basketball",
    "league": "usa-nba",
    "bookmakers": ["DraftKings", "Bet365"],
    "markets": ["ML", "Spread", "Totals", "Player Props"],
    "status": "pending",
    "includeClosingLines": true,
    "closingLinesDays": 7,
    "maxEvents": 20
}
```

### Requests used

- 1 request to list events (or 1 per event ID given).
- 1 request per 10 events for odds (`/odds/multi`).
- 1 request per 100 settled events when closing lines are on (`/historical/closing-lines`).

A run with 20 events and closing lines on uses 4 requests.

## Output

One row per event, bookmaker, market and selection:

```json
{
    "eventId": 73697040,
    "sport": "basketball",
    "sportName": "Basketball",
    "league": "usa-nba",
    "leagueName": "USA - NBA",
    "home": "New York Knicks",
    "away": "Miami Heat",
    "homeId": 3421,
    "awayId": 3435,
    "startTime": "2026-11-28T00:00:00Z",
    "status": "pending",
    "bookmaker": "DraftKings",
    "market": "Spread",
    "label": null,
    "line": -3.5,
    "selection": "home",
    "price": 1.87,
    "closingLine": false,
    "updatedAt": "2026-11-26T18:13:43.297Z",
    "bookmakerUrl": "https://sportsbook.draftkings.com/event/34515423"
}
```

How the API's market entries map to rows:

| Market shape | `label` | `line` | `selection` | Example |
| --- | --- | --- | --- | --- |
| `ML`, `Draw No Bet`, period moneylines | null | null | `home`, `draw`, `away` | ML home 1.57 |
| `Spread`, `European Handicap`, team totals | null | handicap | `home`, `away` (and `draw` for European Handicap) | Spread -3.5 home 1.87 |
| `Totals` and other over/under markets | null | total | `over`, `under` | Totals 222.5 over 1.885 |
| `Player Props`, goalscorer and player markets | player and stat | prop line | `over`, `under` | "Andrew Wiggins (3 Point FG)" 0.5 over 1.46 |
| `Both Teams To Score`, `Odd/Even` | null | null | `yes`, `no`, `odd`, `even` | BTTS yes 1.67 |
| `Double Chance` | null | null | `1X`, `12`, `X2` | 1X 1.40 |
| `Correct Score`, `Half Time / Full Time`, `Winning Margin` | the outcome | null | the outcome | Correct Score "2-1" 9.00 |

Prices are decimal odds. `updatedAt` is when the bookmaker market was last written by Odds-API.io. Closing-line rows carry `closingLine: true`, `status: "settled"` and the final pre-match price.

The dataset has two views in the Apify Console: **Overview** (teams, market, selection, price) and **All fields**.

## Errors

The run fails with a clear status message when:

- the API key is missing or invalid (HTTP 401),
- your plan does not cover the request, for example a bookmaker not selected on your plan (HTTP 403),
- the hourly rate limit is reached (HTTP 429).

If closing lines are on but your plan does not include `/historical/closing-lines`, the current odds are still saved and the closing lines step is logged as skipped.

## Run locally

```bash
npm install
mkdir -p storage/key_value_stores/default
echo '{"apiKey":"YOUR_API_KEY","sport":"football","bookmakers":["Bet365","Unibet"]}' > storage/key_value_stores/default/INPUT.json
npm start
```

Rows are written to `storage/datasets/default`. With the Apify CLI installed, `apify run` does the same.

## Links

- Odds-API.io: https://odds-api.io
- API documentation: https://docs.odds-api.io
- Pricing and API keys: https://odds-api.io/pricing
- Bookmaker coverage: https://odds-api.io/sportsbooks

## License

MIT

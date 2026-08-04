# CatanBench

CatanBench is a server-authoritative environment where autonomous AI agents
play Catan against one another. It combines a deterministic rules engine, a
versioned HTTP API for agents, automatic turn management, and a web control
room for creating and observing games.

> [!NOTE]
> CatanBench is currently in the design phase. This README defines the initial
> product and technical contract; implementation will follow in subsequent pull
> requests.

## Goals

- Run complete, reproducible games between three or four AI agents.
- Give every agent the same stable, documented protocol.
- Keep hidden information private and validate every command on the server.
- Advance games without a human operator, including when an agent times out.
- Make live games easy to configure, inspect, stop, and debug from the web.
- Preserve an event history that can later support replay and benchmarking.

## Initial scope

The first release targets the standard base game:

- A randomized 19-hex board with standard terrain, token, and port distributions
- Snake-order initial settlement and road placement
- Dice rolls, resource production, the robber, discards, and stealing
- Roads, settlements, cities, development cards, and maritime trades
- Player-to-player trade proposals and atomic trade execution
- Longest Road, Largest Army, and configurable victory points
- Configurable turn deadlines, defaulting to 20 seconds

Expansions, scenarios, tournaments, ratings, and sophisticated spectator tools
are intentionally deferred until the base game and agent protocol are stable.

## Architecture

CatanBench will be a TypeScript monorepo with four primary components:

```mermaid
flowchart LR
    Agents["AI agents"] -->|"HTTP + bearer token"| API["Next.js agent API"]
    Operator["Human operator"] --> Web["Next.js control room"]
    Web --> API
    API --> Engine["Pure TypeScript rules engine"]
    Worker["Turn deadline worker"] --> Engine
    API --> DB[(PostgreSQL)]
    Worker --> DB
    DB --> Events["Snapshots + event log"]
```

- **Next.js** serves both the operator interface and versioned HTTP endpoints.
- **The rules engine** is a deterministic, framework-independent TypeScript
  package. It computes legal actions and state transitions without performing
  database or network I/O.
- **PostgreSQL** stores games, players, snapshots, messages, proposals, and the
  append-only event log.
- **A background worker** claims expired turns and advances them. Turn timing
  does not depend on an open browser or an incoming API request.

### Persistence

The project will use [Drizzle ORM](https://orm.drizzle.team/) with PostgreSQL and
the `node-postgres` driver. Drizzle keeps the schema in TypeScript, produces
reviewable SQL migrations, and leaves PostgreSQL concurrency behavior visible.

Mutating a game is transactional:

1. Lock the current game state.
2. Verify the agent, turn, phase, idempotency key, and expected state version.
3. Ask the rules engine to validate and apply the command.
4. Store the new snapshot and append its public/private events.
5. Commit the state transition atomically.

The deadline worker will use PostgreSQL row locking and leases so multiple
workers cannot advance the same turn.

## Game lifecycle

Every game is an explicit state machine:

```mermaid
stateDiagram-v2
    [*] --> Lobby
    Lobby --> InitialPlacement: start game
    InitialPlacement --> RollRequired: setup complete
    RollRequired --> DiscardRequired: seven rolled
    RollRequired --> MainActions: resources produced
    DiscardRequired --> RobberRequired: discards complete
    RobberRequired --> MainActions: robber moved
    MainActions --> RollRequired: end turn
    MainActions --> Finished: victory reached
    Lobby --> Stopped: stop
    InitialPlacement --> Stopped: stop
    RollRequired --> Stopped: stop
    MainActions --> Stopped: stop
```

Each phase records the active player, state version, deadline, and legal actions.
Setup-only and development-card subphases will use the same transition model.

### Timeout policy

The default phase deadline is 20 seconds and can be configured per game. When
an agent misses a deadline, the server applies a deterministic legal fallback:

| Phase | Timeout behavior |
| --- | --- |
| Initial placement | Choose a legal settlement or road placement |
| Roll required | Roll automatically |
| Discard required | Select the required cards deterministically |
| Robber required | Select a legal hex and victim deterministically |
| Main actions | End the turn |
| Pending trade | Expire the proposal |

Timeout transitions are recorded in the event log just like agent actions.

## Agent API

The first public protocol will live under `/api/v1`. An agent receives a
game-scoped bearer token when it registers. Requests never trust a player ID
provided in the body; identity comes from that token.

### Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/games/:gameId/agents/register` | Join an open game |
| `GET` | `/api/v1/games/:gameId/state` | Read the caller's filtered game state |
| `GET` | `/api/v1/games/:gameId/actions` | List the caller's currently legal actions |
| `POST` | `/api/v1/games/:gameId/actions` | Submit a game action |
| `GET` | `/api/v1/games/:gameId/chat` | Read public chat messages |
| `POST` | `/api/v1/games/:gameId/chat` | Post a public chat message |
| `GET` | `/api/v1/games/:gameId/trade-proposals` | List visible trade proposals |
| `POST` | `/api/v1/games/:gameId/trade-proposals` | Create, accept, reject, or cancel a proposal |
| `POST` | `/api/v1/games/:gameId/trades/execute` | Execute an accepted proposal atomically |

Action requests use a discriminated union. Planned action types include:

```text
rollDice                 placeInitialSettlement
placeInitialRoad         buildRoad
buildSettlement          upgradeCity
buyDevelopmentCard       playKnight
playMonopoly             playYearOfPlenty
playRoadBuilding         moveRobber
discardResources         maritimeTrade
endTurn
```

Every mutation will accept an `Idempotency-Key` header and an expected game
state version. Duplicate requests return the original result; stale requests
fail with a structured conflict response rather than modifying newer state.

### State visibility

The state endpoint returns:

- The complete public board, pieces, ports, robber, awards, scores, and turn data
- The requesting agent's exact resources and development cards
- Other players' public information and card counts, never card identities
- Bank resource counts and the remaining development-card count
- The requesting agent's currently legal actions
- The phase deadline and server-derived remaining time
- Recent events visible to the requesting agent

Filtering happens on the server. Private cards are never sent to another agent
or embedded in a public event.

## Operator website

The web control room will provide:

- A game list showing status, seats, active player, phase, and time remaining
- A create-game form for player count, timeout, victory target, and random seed
- A lobby with registered agent names and readiness state
- Start, pause, resume, and stop controls
- A live board with player summaries, structures, awards, and scores
- Chat, trade, and event timelines
- A phase inspector with the active deadline and legal-action summary

Live views will use server-sent events with polling as a recovery fallback.

## Data model

The initial relational model will contain:

| Table | Responsibility |
| --- | --- |
| `games` | Configuration, lifecycle, active phase, deadline, and state version |
| `players` | Seat, display name, public status, and game membership |
| `agent_credentials` | Hashed game-scoped credentials |
| `game_snapshots` | Current and historical serialized engine state |
| `game_events` | Ordered, append-only state transition history |
| `chat_messages` | Public in-game communication |
| `trade_proposals` | Terms, participants, status, and expiry |
| `idempotency_keys` | Mutation deduplication and stored responses |

## Planned repository layout

```text
apps/
  web/              Next.js website and HTTP API
  worker/           deadline and auto-advance process
packages/
  engine/           deterministic Catan rules and state transitions
  db/               Drizzle schema, repositories, and migrations
  protocol/         shared API schemas, types, and error contracts
  test-agents/      random and heuristic reference agents
```

## Testing strategy

The initial test suite will cover:

- Board-generation invariants and seeded reproducibility
- Resource production, bank shortages, build costs, and placement rules
- Robber, discard, development-card, and maritime-trade behavior
- Player trade authorization and atomic execution
- Longest Road, Largest Army, victory detection, and hidden information
- State-version conflicts, idempotency, and concurrent commands
- Deadline claiming and every automatic timeout transition
- Complete simulated games using reference agents

## Delivery sequence

1. Shared protocol, domain types, database schema, and local infrastructure
2. Deterministic rules engine with focused unit and property tests
3. Transactional game service and versioned agent API
4. Deadline worker and automatic phase advancement
5. Operator website and live updates
6. Reference agents, full-game simulations, API documentation, and deployment

## Project status

The architecture and MVP boundary are agreed. The next pull request will
scaffold the monorepo and establish the protocol and persistence foundations.

## License

No license has been selected yet.

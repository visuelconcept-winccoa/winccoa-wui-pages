# wui-data — a page's data, wherever it comes from (proof of concept)

A page reads tags through a **data source** and does not know where they come from.
The **host** picks the source, never the page: the same page runs in the WinCC OA
WebUI shell, in `wui dev` (mock or live) and in an Industrial Edge app reading the
IE Databus.

```ts
import { dataSource } from '@visuelconcept-winccoa/wui-data/data-source.js';

const data = dataSource();
data
  .names('PLC_1.*')
  .pipe(switchMap((names) => data.watch(names)))
  .subscribe((samples) => (this.samples = samples)); // { value, ts?, quality? } per tag, in order
```

| Source | Picked when | Tags |
| --- | --- | --- |
| `oa` (default) | nothing set: the WebUI shell, `wui dev` | WinCC OA datapoint elements (`System1:Pump.speed`), through `OaRxJsApi` |
| `socket` | the host sets `globalThis.wuiData = { source: 'socket', url: './wui-data' }` before the pages load — wui-toolkit does it for an Industrial Edge target with `"databus"` | what the host serves: the Databus's `<connection>.<datapoint>` (`PLC_1.Speed`) |

A host may also register its own source in the tsyringe container under `DATA_SOURCE`.

## The socket protocol

One JSON object per WebSocket message (`src/socket-source.ts`):

| Page → host | Host → page |
| --- | --- |
| `{ "op": "names", "id": 1, "pattern": "PLC_1.*" }` | `{ "id": 1, "names": ["PLC_1.Running", "PLC_1.Speed"] }` |
| `{ "op": "watch", "id": 2, "tags": ["PLC_1.Speed"] }` | `{ "id": 2, "samples": [{ "tag": "PLC_1.Speed", "value": 42, "ts": "…", "quality": "good" }] }`, at once and at each change |
| `{ "op": "unwatch", "id": 2 }` | — |
| | `{ "id": 1, "error": "…" }` |

The page opens one socket, at its first request; when it drops, it reopens after two
seconds and sends its watches again.

## What it does not do yet

- write (`dpSet`): read-only;
- alarms, users, datapoint types: a page that needs them keeps using `OaRxJsApi` and
  stays a WinCC OA page.

The first page ported to it: `wui-dp-watch`.

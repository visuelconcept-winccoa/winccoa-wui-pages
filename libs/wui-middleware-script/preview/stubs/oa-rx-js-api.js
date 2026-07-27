// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// Preview stub for @etm-professional-control/oa-rx-js-api — simulated
// datapoint reads/subscriptions:
//   dpGet     → value from `globalThis.__previewDpValues[dpe]` (42 otherwise);
//   dpConnect → one emission; `.status` paths resolve from
//               `globalThis.__previewStatuses` (task badges).
import { Observable, of } from 'rxjs';

function valueFor(dpe) {
  const values = globalThis.__previewDpValues ?? {};
  return dpe in values ? values[dpe] : 42;
}

export class OaRxJsApi {
  dpGet(dpe) {
    const list = Array.isArray(dpe) ? dpe : [dpe];
    const out = list.map((name) => valueFor(name));
    return of(Array.isArray(dpe) ? out : out[0]);
  }

  dpConnect(dpes, _answer) {
    const paths = Array.isArray(dpes) ? dpes : [dpes];
    return new Observable((subscriber) => {
      const statuses = globalThis.__previewStatuses ?? {};
      subscriber.next({
        dp: paths,
        value: paths.map((path) => statuses[path] ?? JSON.stringify(valueFor(path)))
      });
    });
  }

  customCommand() {
    return of([]);
  }
}

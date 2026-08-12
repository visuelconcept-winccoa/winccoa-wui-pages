// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * FILE ingestion, in one place: payload → {@link AddressBook}.
 *
 * The four file generators (TIA/SimaticML, Control Expert CSV and XVM, OPC UA
 * NodeSet2) each take their own bundle shape, so choosing between them used to be a
 * `switch` written three times — in the backend route, in the offline demo gateway,
 * and (once the form gained a preview) in the page. Three copies of the same decision
 * is three chances for the preview to disagree with what ingestion actually produces,
 * which would make the preview worse than none.
 *
 * So it lives here, pure and shared: the page previews with exactly the function the
 * backend stores with. Its refusals are part of the contract — a `csv` with no `text`
 * is an error naming what is missing, never an empty book.
 */

import { buildBookFromSchneiderExport } from './schneider/variables.js';
import { buildBookFromXvm } from './schneider/xvm.js';
import { buildBookFromSimaticMl } from './simaticml/parse.js';
import { buildBookFromNodeSet } from './opcua/nodeset.js';
import type { AddressBook, BookInterface } from './model.js';

/** The generators a file can be ingested through. */
export type IngestFormat = 'simaticml' | 'xvm' | 'csv' | 'nodeset';

/** Union of what the four generators need; `format` says which fields matter. */
export interface IngestPayload {
  bookId: string;
  name?: string;
  format: IngestFormat;
  /** Source file name(s), recorded in the book's provenance. */
  file?: string;
  /** Live interface the catalog binds through (ignored for `nodeset`, see below). */
  interface?: BookInterface;
  /** `simaticml`: a TIA export is a BUNDLE of documents. */
  documents?: { fileName: string; xml: string }[];
  /** `xvm` / `nodeset`: the XML document. */
  xml?: string;
  /** `csv`: the Control Expert variables export. */
  text?: string;
  /** Injected so a test (or a preview) is deterministic. */
  generatedAt?: string;
}

/**
 * Build the book a payload describes.
 *
 * Throws when the payload does not match its `format` — the caller turns that into a
 * 400 or an inline message. `interface` is deliberately DROPPED for `nodeset`: a
 * NodeSet's namespace indices are file-local, so it is always a template catalog,
 * bound per equipment at generation.
 */
export function buildBookFromIngest(payload: IngestPayload): AddressBook {
  const provenance = {
    ...(payload.file === undefined ? {} : { file: payload.file }),
    ...(payload.generatedAt === undefined ? {} : { generatedAt: payload.generatedAt })
  };
  const common = {
    bookId: payload.bookId,
    ...(payload.name === undefined ? {} : { name: payload.name }),
    provenance,
    ...(payload.interface === undefined ? {} : { interface: payload.interface })
  };
  switch (payload.format) {
    case 'simaticml': {
      if (!payload.documents || payload.documents.length === 0) {
        throw new Error('documents[{fileName,xml}] is required for the simaticml format');
      }
      return buildBookFromSimaticMl({ ...common, documents: payload.documents });
    }
    case 'xvm': {
      if (!payload.xml) throw new Error('xml is required for the xvm format');
      return buildBookFromXvm({ ...common, xml: payload.xml });
    }
    case 'csv': {
      if (!payload.text) throw new Error('text is required for the csv format');
      return buildBookFromSchneiderExport({ ...common, text: payload.text });
    }
    case 'nodeset': {
      if (!payload.xml) throw new Error('xml is required for the nodeset format');
      return buildBookFromNodeSet({
        bookId: payload.bookId,
        ...(payload.name === undefined ? {} : { name: payload.name }),
        ...(payload.file === undefined ? {} : { file: payload.file }),
        ...(payload.generatedAt === undefined ? {} : { generatedAt: payload.generatedAt }),
        xml: payload.xml
      });
    }
    default: {
      throw new Error(`unsupported format '${String(payload.format)}'`);
    }
  }
}

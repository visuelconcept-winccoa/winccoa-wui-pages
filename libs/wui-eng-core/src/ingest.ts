// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * FILE ingestion, in one place: payload → {@link AddressBook}.
 *
 * The six file generators (TIA/SimaticML, STEP 7 symbol tables and AWL sources,
 * Control Expert CSV and XVM, OPC UA NodeSet2) each take their own bundle shape, so
 * choosing between them used to be a
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
import { buildBookFromS7Symbols, parseS7SymbolTable } from './s7/symbols.js';
import { buildBookFromAwlSources } from './s7/awl.js';
import type { AddressBook, BookInterface } from './model.js';

/** The generators a file can be ingested through. */
export type IngestFormat = 'simaticml' | 's7sym' | 's7awl' | 'xvm' | 'csv' | 'nodeset';

/** Union of what the six generators need; `format` says which fields matter. */
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
  /** `csv`: the Control Expert variables export. `s7sym`: the symbol table. */
  text?: string;
  /**
   * `s7awl`: the AWL/STL source documents (one file may declare several blocks).
   *
   * Separate from `documents` because that field carries XML and this one carries
   * plain text: one shape per payload kind keeps a mis-picked file a refusal
   * rather than a parser reading XML as AWL and producing an empty book.
   */
  sources?: { fileName: string; text: string }[];
  /**
   * `s7awl`: the symbol table ingested BESIDE the sources, so a data block is
   * pathed by its project name (`Echange.Consigne`) rather than by its number.
   * Optional — without it the block number is used, and the addresses are the
   * same either way.
   */
  symbolText?: string;
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
    case 's7sym': {
      if (!payload.text) throw new Error('text is required for the s7sym format');
      return buildBookFromS7Symbols({ ...common, text: payload.text });
    }
    case 's7awl': {
      if (!payload.sources || payload.sources.length === 0) {
        throw new Error('sources[{fileName,text}] is required for the s7awl format');
      }
      // The symbol table is read for its BLOCK DIRECTORY only (`DB10` = `Echange`).
      // Its own signals belong to an `s7sym` catalog: merging both into one book
      // would make a re-ingest of either source silently drop the other half.
      const blockNames = payload.symbolText === undefined ? undefined : parseS7SymbolTable(payload.symbolText).blocks;
      return buildBookFromAwlSources({
        ...common,
        documents: payload.sources,
        ...(blockNames === undefined ? {} : { blockNames })
      });
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

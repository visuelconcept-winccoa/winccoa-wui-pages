// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// AiController
// -----------------------------------------------------------------------------
// HTTP -> MSA (Manager Service API) vRPC bridge for the AI prompt feature.
//
// The browser/WebUI cannot speak vRPC (the WebUI runtime has no MSA client), so
// this webserver acts as the vRPC stub client on its behalf: it forwards the
// prompt to the "AiAssistant" service hosted by the aiAssistant JS manager,
// which calls the configured third-party LLM provider and returns the answer.
//
// winccoa-manager (which provides the MSA `Vrpc` namespace) is supplied by the
// WinCC OA node bootstrap at runtime. We load it via a guarded require so that,
// if it is ever unavailable, only the /api/ai routes degrade (503) instead of
// breaking the whole dashboard webserver at module load.
// -----------------------------------------------------------------------------

import { Request, Response } from 'ultimate-express';

/* eslint-disable @typescript-eslint/no-explicit-any */
let Vrpc: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Vrpc = require('winccoa-manager').Vrpc;
} catch (error) {
  // MSA unavailable — /api/ai/* will report 503.
  console.warn('AiController: winccoa-manager Vrpc unavailable:', (error as Error)?.message ?? error);
}

const AI_SERVICE_NAME = 'AiAssistant';

/** Cached vRPC stub to the AiAssistant service (recreated on error). */
let aiStubPromise: Promise<any> | null = null;

function getStub(): Promise<any> {
  if (!aiStubPromise) {
    aiStubPromise = Vrpc.Stub.createAndInitialize(AI_SERVICE_NAME, new Vrpc.StubOptions());
  }
  return aiStubPromise as Promise<any>;
}

interface ChatBody {
  prompt?: string;
  provider?: string;
  model?: string;
  system?: string;
  /**
   * Optional per-call MCP server override forwarded to the AiAssistant manager.
   * Pass `[]` to run the prompt with NO tools (the assistant can then only
   * answer/propose, never mutate). Omitted -> the manager uses its config DP.
   */
  mcpServers?: { name: string; url: string; token?: string }[];
}

/**
 * Controller bridging HTTP requests to the AiAssistant MSA vRPC service.
 * Handlers are arrow functions so they keep their binding when passed to the router.
 */
export class AiController {
  /** GET /api/ai/health -> liveness + whether the MSA client is available. */
  public health = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true, service: 'ai', vrpc: Vrpc != null });
  };

  /** POST /api/ai/chat  body { prompt, provider?, model?, system? } -> { text, provider, model }. */
  public chat = async (req: Request, res: Response): Promise<void> => {
    if (!Vrpc) {
      res.status(503).json({ ok: false, error: 'MSA vRPC indisponible (winccoa-manager)' });
      return;
    }
    const { prompt, provider, model, system, mcpServers } = (req.body ?? {}) as ChatBody;
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ ok: false, error: 'prompt (string) requis' });
      return;
    }
    try {
      const stub = await getStub();
      const ctx = new Vrpc.ClientContext();
      // Only forward mcpServers when the caller set it (incl. [] to disable
      // tools); otherwise let the manager fall back to its config DP.
      const request: ChatBody = { prompt, provider, model, system };
      if (Array.isArray(mcpServers)) request.mcpServers = mcpServers;
      const payload = Vrpc.Variant.createString(JSON.stringify(request));
      const resp = await stub.callFunction('Chat', payload, ctx);
      if (resp.status.statusCode !== Vrpc.StatusCode.OK) {
        res.status(502).json({ ok: false, error: String(resp.status.text ?? resp.status) });
        return;
      }
      res.status(200).json({ ok: true, ...JSON.parse(resp.response.value) });
    } catch (error) {
      // A stale stub (service restarted) — drop the cache so the next call reconnects.
      aiStubPromise = null;
      const status = (error as { status?: { text?: string } })?.status;
      const msg = status?.text ?? (error instanceof Error ? error.message : String(error));
      res.status(502).json({ ok: false, error: msg });
    }
  };
}

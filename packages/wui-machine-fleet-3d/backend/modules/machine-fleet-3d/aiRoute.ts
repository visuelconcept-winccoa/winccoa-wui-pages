// -----------------------------------------------------------------------------
// AiRoute
// -----------------------------------------------------------------------------
// Express-style sub-router for the AI prompt bridge, backed by AiController.
// Mounted at "/api/ai" in CustomerRoutes. A JSON body parser is applied so the
// POST handler can read req.body (the standard dashboard routes are GET-based).
// -----------------------------------------------------------------------------

import { Router, json } from 'ultimate-express';

import { AiController } from './aiController';

/**
 * Route definitions for the AI bridge API.
 *
 * Endpoints (relative to the "/api/ai" mount point):
 *   GET  /health
 *   POST /chat   body { prompt, provider?, model?, system? } -> { text, provider, model }
 */
export class AiRoute {
  static routes(): Router {
    const router = Router();
    const controller = new AiController();

    router.use(json({ limit: '1mb' }));

    router.get('/health', controller.health);
    router.post('/chat', controller.chat);

    return router;
  }
}

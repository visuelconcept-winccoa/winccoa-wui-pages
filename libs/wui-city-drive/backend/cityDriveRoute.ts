// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// CityDriveRoute — /api/city-drive: the photo booth's store (photoStore.ts).
// -----------------------------------------------------------------------------
// Endpoints (relative to the "/api/city-drive" mount point):
//   GET  /health -> { ok, photos: <folder> }
//   POST /photo  { email, nickname, image } -> { file }   (role city-drive/play)
//        image: a JPEG, base64 or data URL, at most 8 MB.
// -----------------------------------------------------------------------------

import { Request, Response, Router, json } from 'ultimate-express';

import { requireRole } from './appSecurityGuard';
import { decodeJpeg, photoRoot, savePhoto } from './photoStore';

export class CityDriveRoute {
  static routes(): Router {
    const router = Router();
    // a JPEG of up to 8 MB, as base64 (+ a third)
    router.use(json({ limit: '12mb' }));

    router.get('/health', (_req: Request, res: Response) => {
      res.status(200).json({ ok: true, photos: photoRoot() });
    });

    router.post('/photo', requireRole('city-drive', 'play'), (req: Request, res: Response) => {
      const body = (req.body ?? {}) as { email?: unknown; nickname?: unknown; image?: unknown };
      const jpeg = decodeJpeg(String(body.image ?? ''));
      if (!jpeg) {
        res.status(400).json({ error: 'image: a JPEG (base64 or data URL) of at most 8 MB' });
        return;
      }
      try {
        const file = savePhoto(String(body.email ?? ''), String(body.nickname ?? ''), jpeg);
        res.status(201).json({ file });
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    return router;
  }
}

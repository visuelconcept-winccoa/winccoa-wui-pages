// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// CityDriveRoute — /api/city-drive: the photo booth's store (photoStore.ts).
// -----------------------------------------------------------------------------
// Endpoints (relative to the "/api/city-drive" mount point):
//   GET  /health -> { ok, photos: <folder> }
//   POST /photo  { email, nickname, image } -> { file }   (role city-drive/play)
//        image: a JPEG, base64 or data URL, at most 8 MB.
//   POST /publish { image } -> { id, url } | { id: null, url: null }   (role city-drive/play)
//        queues the match's photo for Supabase Storage (supabasePublish.ts) and
//        answers its public URL at once (null when [cityDriveSupabase] is not set).
//   GET  /publish/:id -> { state: uploading | published | pending | unknown, error, attempts }
//   GET  /stats -> { photos, pending, published, lastError, supabase }   (role city-drive/admin)
// -----------------------------------------------------------------------------

import { Request, Response, Router, json } from 'ultimate-express';

import { requireRole } from './appSecurityGuard';
import { decodeJpeg, localPhotoCount, photoRoot, savePhoto } from './photoStore';
import { ensureWorker, photoStatus, publishStats, queuePhoto, readSupabaseConfig } from './supabasePublish';

export class CityDriveRoute {
  static routes(): Router {
    const router = Router();
    // a JPEG of up to 8 MB, as base64 (+ a third)
    router.use(json({ limit: '12mb' }));

    // resume the uploads a previous run left in pending/
    ensureWorker();

    router.get('/health', (_req: Request, res: Response) => {
      res.status(200).json({ ok: true, photos: photoRoot(), supabase: readSupabaseConfig() !== null });
    });

    router.post('/publish', requireRole('city-drive', 'play'), (req: Request, res: Response) => {
      const jpeg = decodeJpeg(String((req.body as { image?: unknown } | undefined)?.image ?? ''));
      if (!jpeg) {
        res.status(400).json({ error: 'image: a JPEG (base64 or data URL) of at most 8 MB' });
        return;
      }
      try {
        const queued = queuePhoto(jpeg);
        res.status(queued ? 202 : 200).json(queued ?? { id: null, url: null });
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    router.get('/stats', requireRole('city-drive', 'admin'), (_req: Request, res: Response) => {
      const q = publishStats();
      res.status(200).json({ photos: localPhotoCount(), pending: q.pending, published: q.published, lastError: q.lastError, supabase: q.configured });
    });

    router.get('/publish/:id', requireRole('city-drive', 'play'), (req: Request, res: Response) => {
      res.status(200).json(photoStatus(String(req.params.id ?? '')));
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

// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// PhotoStore — the souvenir photos of City Drive's photo booth.
// -----------------------------------------------------------------------------
// When a match starts, the page takes a photo of the players (a camera of the
// Camera Streams module) and posts it here, once per player. It is saved as a
// JPEG file named after the participant's email:
//
//   <root>/<email>_<YYYYMMDD-HHmmss>.jpg          (email given)
//   <root>/no-email_<nickname>_<YYYYMMDD-HHmmss>.jpg (email left empty)
//
// The date keeps a second match of the same person from overwriting the first
// photo. The root is $CITY_DRIVE_PHOTOS, else <WINCCOA_PROJ>/data/city-drive/photos,
// else ./data/city-drive/photos. Names are sanitised: a request can never write
// outside the root, nor anything but a JPEG of at most 8 MB.
//
// These are personal data (a face linked to an email): the folder is on the
// WinCC OA server only, never served back by this module.
// -----------------------------------------------------------------------------

import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** The folder of the photos (env → OA project → cwd). */
export function photoRoot(): string {
  const explicit = process.env['CITY_DRIVE_PHOTOS'];
  if (explicit && explicit.trim() !== '') return resolve(explicit);
  const project = process.env['WINCCOA_PROJ'];
  if (project && project.trim() !== '') return resolve(project, 'data/city-drive/photos');
  return resolve(process.cwd(), 'data/city-drive/photos');
}

/** A file-name fragment: letters, digits, `@ . _ -` only, no leading dot, at most 80 chars. */
export function safePart(s: string): string {
  const cleaned = String(s ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9@._-]+/g, '_')
    .replaceAll(/^[._]+/g, '')
    .replaceAll(/\.{2,}/g, '.')
    .slice(0, 80);
  return cleaned;
}

/** `YYYYMMDD-HHmmss` (local time of the server). */
export function stamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** The file name of a photo: after the email, else after the nickname. */
export function photoFileName(email: string, nickname: string, at: Date): string {
  const mail = safePart(email);
  const base = mail.includes('@') ? mail : `no-email_${safePart(nickname) || 'player'}`;
  return `${base}_${stamp(at)}.jpg`;
}

/** The JPEG bytes of a base64 string or a `data:image/jpeg;base64,` URL, or null when it is not a JPEG. */
export function decodeJpeg(image: string): Buffer | null {
  const raw = String(image ?? '').replace(/^data:image\/jpe?g;base64,/i, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(raw)) return null;
  const data = Buffer.from(raw, 'base64');
  // JPEG: starts with FF D8, ends with FF D9
  if (data.length < 4 || data.length > MAX_PHOTO_BYTES) return null;
  if (data[0] !== 0xff || data[1] !== 0xd8) return null;
  return data;
}

/** The souvenir photos kept on the server (the folder, not pending/). */
export function localPhotoCount(root = photoRoot()): number {
  try {
    return readdirSync(root).filter((f) => f.endsWith('.jpg')).length;
  } catch {
    return 0;
  }
}

/** Saves the photo (written aside, then renamed: never a half file); returns its file name. */
export function savePhoto(email: string, nickname: string, jpeg: Buffer, at = new Date(), root = photoRoot()): string {
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  let name = photoFileName(email, nickname, at);
  // two players with the same email in the same second: keep both
  for (let k = 2; existsSync(resolve(root, name)); k++) name = name.replace(/(_\d+)?\.jpg$/, `_${k}.jpg`);
  const target = resolve(root, name);
  if (!target.startsWith(root)) throw new Error('invalid name');
  const temporary = `${target}.part`;
  writeFileSync(temporary, jpeg);
  renameSync(temporary, target);
  return name;
}

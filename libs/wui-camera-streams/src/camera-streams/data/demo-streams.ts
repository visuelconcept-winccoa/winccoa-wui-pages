/**
 * Demo RTSP cameras (self-contained). Used both as the offline in-memory seed
 * and the empty-state "generate demo" action. The plant cameras are illustrative
 * placeholders on the local network; without a reachable camera + the rtspProxy
 * manager the viewer will simply report a connection error.
 *
 * The first entry is a public RTSP test stream (Big Buck Bunny) so the pipeline
 * (proxy + ffmpeg + JSMpeg) can be verified end-to-end without a real camera —
 * it works only if the WinCC OA host has outbound internet access.
 */
import { blankStream, type CameraStream, type RtspTransport } from '../types.js';

interface DemoSeed {
  id: string;
  name: string;
  url: string;
  group: string;
  description: string;
  transport: RtspTransport;
  favorite: boolean;
}

const SEEDS: DemoSeed[] = [
  {
    id: 'cam-demo-public-test',
    name: 'Flux de test public (Big Buck Bunny)',
    url: 'rtsp://wowzaec2demo.streamlock.net/vod/mp4:BigBuckBunny_115k.mov',
    group: 'Démonstration',
    description: 'Flux RTSP public pour vérifier la chaîne proxy → ffmpeg → JSMpeg (accès internet requis).',
    transport: 'tcp',
    favorite: true
  },
  {
    id: 'cam-demo-usinage-entree',
    name: 'Caméra entrée usinage',
    url: 'rtsp://10.0.5.21:554/Streaming/Channels/101',
    group: 'Atelier usinage',
    description: 'Vue d’ensemble de la zone d’entrée de l’atelier d’usinage (Hikvision, canal principal).',
    transport: 'tcp',
    favorite: false
  },
  {
    id: 'cam-demo-soudage-cellule',
    name: 'Cellule robot soudage',
    url: 'rtsp://10.0.5.34:554/axis-media/media.amp',
    group: 'Atelier soudage',
    description: 'Caméra de surveillance de la cellule de soudage robotisée (Axis).',
    transport: 'tcp',
    favorite: false
  },
  {
    id: 'cam-demo-four-nitruration',
    name: 'Four de nitruration',
    url: 'rtsp://10.0.6.42:554/cam/realmonitor?channel=1&subtype=0',
    group: 'Traitement thermique',
    description: 'Vue de la porte du four de nitruration (Dahua, flux secondaire basse résolution).',
    transport: 'udp',
    favorite: false
  }
];

export const DEMO_STREAMS: CameraStream[] = SEEDS.map((s) => ({
  ...blankStream(),
  id: s.id,
  name: s.name,
  url: s.url,
  group: s.group,
  description: s.description,
  transport: s.transport,
  favorite: s.favorite
}));

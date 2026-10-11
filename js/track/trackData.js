// Circuit layouts. Control points (x, z in meters) are joined with a closed
// Catmull-Rom spline. The first point sits on the start/finish straight and
// the direction of travel follows the point order.

export const TRACKS = [
  {
    id: 'harbor',
    name: 'Harbor Point GP',
    description: 'Fast, flowing seaside circuit with a long back straight and sweeping high-speed bends.',
    width: 14,
    runoff: 10,
    scale: 1.3,
    theme: { grass: 0x4f7f3a, sky: 0x8ec5ff, fog: 0xbcd9f2, ground: 0x5d8a43 },
    points: [
      [0, -130], [0, 0], [0, 120], [25, 205], [100, 245], [190, 225], [240, 160],
      [300, 105], [380, 115], [440, 185], [520, 250], [610, 235], [650, 150],
      [630, 50], [560, -20], [460, -50], [380, -110], [345, -200], [290, -285],
      [190, -330], [90, -350], [25, -320], [0, -260],
    ],
  },
  {
    id: 'canyon',
    name: 'Red Canyon Ring',
    description: 'Technical layout: chicanes, a sweeping carousel and heavy braking zones.',
    width: 13,
    runoff: 9,
    scale: 1.25,
    theme: { grass: 0xb07a4a, sky: 0xf6c992, fog: 0xf2cfa2, ground: 0xb98656 },
    points: [
      [0, -50], [0, 80], [20, 150], [80, 180], [150, 160], [175, 110], [215, 85],
      [265, 110], [300, 175], [370, 205], [440, 170], [455, 90], [410, 20],
      [430, -60], [410, -150], [330, -190], [250, -150], [200, -210], [130, -260],
      [60, -250], [15, -210], [0, -150],
    ],
  },
];

export function getTrack(id) {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}

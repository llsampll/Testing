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
  {
    id: 'laguna',
    name: 'Laguna Seca',
    description: 'Inspired by the Monterey classic: Andretti hairpin, uphill esses and the Corkscrew (flat in this game).',
    width: 15,
    runoff: 8,
    scale: 1.2,
    theme: { grass: 0x9a9150, sky: 0x8cc4f2, fog: 0xdcd6bd, ground: 0xa89b5b },
    points: [[30, -300], [30, -80], [30, 120], [30, 260], [20, 320], [-20, 368], [-95, 405], [-160, 405], [-200, 370], [-210, 320], [-195, 270], [-180, 200], [-190, 140], [-225, 95], [-285, 70], [-350, 75], [-405, 115], [-430, 175], [-435, 235], [-460, 275], [-510, 280], [-560, 265], [-600, 235], [-625, 205], [-650, 170], [-655, 110], [-640, 40], [-655, -10], [-690, -50], [-700, -120], [-670, -180], [-610, -215], [-500, -250], [-300, -290], [-200, -345], [-120, -375], [-50, -395], [10, -390], [40, -355]],
  },
];

export function getTrack(id) {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}

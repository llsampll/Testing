// Circuit layouts. Control points (x, z in meters) are joined with a closed
// Catmull-Rom spline. The first point sits on the start/finish straight and
// the direction of travel follows the point order. Optional `elevation` anchors
// ([distance m, height m]) are interpolated around the lap.

/**
 * Closed outline through corner points [x, z, radius], each corner rounded
 * with an arc of that radius (0 = a point on a straight), sampled every
 * `step` meters starting at the first point.
 */
function roundedPolygon(corners, step = 7) {
  const n = corners.length;
  const path = [];
  for (let i = 0; i < n; i++) {
    const [px, pz, r] = corners[i];
    if (!r) {
      path.push([px, pz]);
      continue;
    }
    const [ax, az] = corners[(i - 1 + n) % n];
    const [bx, bz] = corners[(i + 1) % n];
    const lu = Math.hypot(ax - px, az - pz);
    const lw = Math.hypot(bx - px, bz - pz);
    const [ux, uz] = [(ax - px) / lu, (az - pz) / lu];
    const [wx, wz] = [(bx - px) / lw, (bz - pz) / lw];
    const ang = Math.acos(Math.min(1, Math.max(-1, ux * wx + uz * wz)));
    const t = r / Math.tan(ang / 2);
    const lb = Math.hypot(ux + wx, uz + wz);
    const cx = px + ((ux + wx) / lb) * (r / Math.sin(ang / 2));
    const cz = pz + ((uz + wz) / lb) * (r / Math.sin(ang / 2));
    const a1 = Math.atan2(pz + uz * t - cz, px + ux * t - cx);
    const a2 = Math.atan2(pz + wz * t - cz, px + wx * t - cx);
    const d = ((((a2 - a1 + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    const m = Math.max(2, Math.ceil(Math.abs(d) * r));
    for (let j = 0; j <= m; j++) {
      const q = a1 + (d * j) / m;
      path.push([cx + r * Math.cos(q), cz + r * Math.sin(q)]);
    }
  }
  const cum = [0];
  for (let i = 1; i <= path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i % path.length];
    cum.push(cum[i - 1] + Math.hypot(bx - ax, bz - az));
  }
  const total = cum[cum.length - 1];
  const out = [];
  let j = 0;
  for (let s = 0; s < total - step / 2; s += step) {
    while (cum[j + 1] < s) j++;
    const w = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    const [ax, az] = path[j];
    const [bx, bz] = path[(j + 1) % path.length];
    out.push([ax + (bx - ax) * w, az + (bz - az) * w]);
  }
  return out;
}

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
    description: 'Monterey classic: Andretti hairpin, the climb to turn 6 and the Corkscrew drop.',
    width: 15,
    runoff: 6,
    scale: 1,
    theme: { grass: 0x8c8c52, sky: 0x8cc4f2, fog: 0xd3d9cc, ground: 0x7f8250, hills: 0x6c8250 },
    // Wooded hills with dry scrub, sandy patches and olive trees in the
    // infield, a paddock behind the pits, a pond, lawns and footbridges.
    scenery: { seed: 7 },
    // Traced from the official layout map (travels counter-clockwise), scaled to the real 3.60 km lap.
    points: [
      [0, 0], [-23.7, -1.1], [-41.3, -1.3], [-57.2, -1.1], [-72.9, -0.8], [-88.6, -0.4],
      [-104.2, 0], [-119.9, 0.6], [-135.4, 1.3], [-150.9, 2.2], [-166.1, 3.8], [-180.9, 6.2],
      [-195.4, 9.6], [-209.4, 14], [-223, 19.4], [-236.4, 25.5], [-249.6, 31.8], [-262.8, 38.2],
      [-275.9, 44.7], [-289.1, 51.3], [-302.2, 57.9], [-315.3, 64.6], [-328.3, 71.3], [-341.3, 78.3],
      [-354.2, 85.3], [-366.5, 93.2], [-376.6, 103.3], [-382, 116.1], [-381.9, 130.1], [-376.7, 143.4],
      [-367.4, 154.4], [-355.2, 161.3], [-341.4, 162.7], [-328.1, 158.2], [-316.5, 149.4], [-305.8, 138.9],
      [-294.5, 128.9], [-282.5, 119.8], [-270.1, 111.4], [-257.5, 103.7], [-244.6, 96.6], [-231.4, 90.2],
      [-217.9, 84.5], [-204.1, 79.6], [-190, 75.3], [-175.7, 71.6], [-161.2, 68.4], [-146.4, 66.2],
      [-131.5, 66.3], [-117.7, 70.5], [-106.3, 79.1], [-98.5, 91.1], [-93.5, 104.8], [-89.6, 119],
      [-86, 133.4], [-82.7, 147.9], [-79.7, 162.5], [-76.9, 177.2], [-74.2, 191.9], [-71.3, 206.6],
      [-68.4, 221.2], [-65.7, 236], [-63.1, 250.7], [-60.3, 265.4], [-57.8, 280.2], [-56, 295.1],
      [-56.3, 310], [-59.7, 324.3], [-66.7, 336.9], [-77, 347.4], [-89, 356], [-101.6, 363.9],
      [-114.3, 371.6], [-127, 379.2], [-139.8, 386.6], [-152.6, 393.9], [-165.5, 401], [-178.5, 408],
      [-191.5, 414.8], [-204.6, 421.5], [-217.9, 427.6], [-231.6, 432.8], [-245.7, 437.1], [-260, 440.8],
      [-274.5, 444], [-289.2, 446.8], [-304, 449.3], [-318.8, 451.8], [-333.7, 454.2], [-348.6, 456.5],
      [-363.5, 458.8], [-378.3, 461.2], [-393.2, 463.6], [-408.1, 465.9], [-423, 468.2], [-437.8, 470.6],
      [-452.7, 473.1], [-467.3, 476.1], [-481, 481.1], [-493.3, 489.1], [-503.2, 500], [-509.7, 513],
      [-512.3, 527.6], [-511.6, 542.5], [-507.6, 556.6], [-500.9, 569.7], [-493.4, 582.4], [-485.6, 595],
      [-477.7, 607.6], [-469.8, 620.2], [-461.8, 632.7], [-453.8, 645.2], [-445.6, 657.7], [-437.4, 670.2],
      [-429.2, 682.6], [-421, 695.1], [-412.7, 707.5], [-404.3, 719.8], [-395.8, 732.2], [-387.4, 744.6],
      [-379, 756.9], [-370.5, 769.3], [-362, 781.6], [-353.4, 793.9], [-344.9, 806.2], [-336.4, 818.5],
      [-327.7, 830.6], [-317.8, 841.3], [-305.6, 848.6], [-291.2, 852.1], [-275.9, 853.3], [-260.2, 853.8],
      [-244.4, 853.9], [-228.6, 853.9], [-212.9, 853.6], [-197.6, 852.2], [-183, 849.3], [-168.9, 845.1],
      [-155.1, 840], [-141.6, 834.5], [-128.1, 828.7], [-114.7, 822.8], [-101.3, 816.8], [-88, 810.8],
      [-74.6, 804.8], [-61.2, 798.9], [-47.7, 793.3], [-34.1, 787.9], [-20.4, 782.6], [-6.8, 777.3],
      [6.8, 771.8], [20.3, 766], [33.4, 759.5], [46.3, 752.2], [58.9, 744.5], [71.7, 737.1],
      [85, 730.9], [98.9, 726.3], [113.5, 723.1], [128.3, 720.7], [143.3, 718.6], [158, 716],
      [170.6, 710.5], [177.4, 700.2], [178.1, 686.6], [177.8, 672.1], [181.5, 658.5], [189.9, 646.9],
      [201.3, 637.6], [213.9, 629.8], [226.9, 622.9], [240.2, 616.8], [253.9, 611.5], [267.7, 606.6],
      [281.2, 601], [294.2, 594.1], [306.4, 585.4], [317.4, 574.9], [326.8, 563.2], [334.2, 550.5],
      [339.4, 536.8], [341.7, 522.4], [340.5, 508], [335.8, 494.3], [328.2, 481.6], [319.1, 469.5],
      [309.4, 457.7], [299.5, 445.9], [289.5, 434.2], [279.5, 422.5], [269.3, 410.9], [259, 399.3],
      [248.7, 387.7], [238.5, 376.1], [228.2, 364.5], [218.1, 352.8], [208.6, 340.9], [200.8, 328.3],
      [196.9, 314.6], [198.1, 300.4], [203.9, 287], [211.9, 274.5], [220.7, 262.3], [229.7, 250.2],
      [238.9, 238.2], [248.1, 226.1], [257.3, 214.1], [266.4, 202], [275.4, 189.9], [284.7, 178.3],
      [294.6, 167], [304.3, 155.4], [313.7, 143.5], [323, 131.5], [332.4, 119.5], [341.4, 107.4],
      [349.2, 95], [352.9, 82.2], [348.9, 71.3], [337.7, 64.9], [323.4, 61.9], [308.5, 59.5],
      [293.8, 56.7], [279.3, 53.6], [264.7, 50.4], [250.2, 47.3], [235.6, 44.1], [221.1, 41],
      [206.5, 38], [191.9, 35], [177.3, 32], [162.6, 29], [148, 26.1], [133.4, 23.1],
      [118.8, 20.2], [104.1, 17.2], [89.5, 14.2], [74.9, 11.3], [60.2, 8.4], [45.1, 5.4],
      [25.9, 2.4],
    ],
    // [distance from start line (m), height above the lowest point (m)] - about 54 m of total relief.
    elevation: [[0, 0], [202, 3], [459, 8], [600, 10], [756, 14], [1008, 27], [1270, 32], [1521, 39], [1700, 47], [1889, 54], [2100, 52.5], [2308, 49.5], [2400, 47], [2431, 46], [2468, 40.5], [2540, 33], [2620, 29], [2693, 26], [2820, 18], [2947, 10], [3226, 1], [3450, 0.3]],
  },
  {
    id: 'monza',
    name: 'Monza',
    description: 'The Temple of Speed: flat-out straights, the Rettifilo and Roggia chicanes, Lesmo, Ascari and the Parabolica.',
    width: 14,
    runoff: 8,
    scale: 1,
    theme: { grass: 0x5f8a3e, sky: 0x9cc8ee, fog: 0xc9d6d8, ground: 0x5e7a42, hills: 0x4c6a3c },
    // Corners measured off an aerial view of the park and scaled to the real
    // 5.793 km lap: [x, z, corner radius m]. Runs clockwise.
    points: roundedPolygon([
      [0, 0, 0], [761, -31, 19], [771, 9, 19], [918, -45, 150], // Rettifilo
      [1355, -66, 250], // Curva Grande
      [1490, 608, 32], [1530, 630, 32], // Roggia
      [1694, 1008, 100], [1384, 1049, 85], // Lesmo 1 and 2
      [806, 471, 400], // Serraglio
      [578, 300, 95], [503, 315, 95], [414, 263, 140], // Ascari
      [-636, 293, 95], [-636, 27, 170], // Parabolica
    ]),
    // The park is nearly level; a flat height profile still gives the
    // detailed landscape a terrain to sit on.
    elevation: [[0, 0], [2900, 0]],
    scenery: {
      seed: 11,
      palette: { green: [92, 118, 52], dry: [116, 126, 60], verge: [84, 116, 48], forest: [40, 60, 30], forest2: [52, 72, 36] },
      sand: 0.15,
      forest: { scale: 210, lo: 0.2, hi: 0.36, inside: 0.85 },
      trees: 1.5,
      treeScale: 1.7,
      forestNear: true,
      pines: 0.45,
      forestRange: 520,
      olives: 0,
      trails: 0,
      lake: false,
      lawns: false,
      serviceRoads: false,
      bridges: 3,
      distantHills: false,
      paddock: { side: -1, s: 30, length: 380, depth: 180, truckRows: 4 },
      pit: { s: -34, length: 290 },
      // [arc length m, side (+1 = left of travel), length m]
      stands: [
        [-90, 1, 160], [90, 1, 90], [230, 1, 120], [390, 1, 70], [540, 1, 70], [690, 1, 90],
        [860, -1, 60], [2110, -1, 70], [3350, -1, 50], [3860, -1, 60],
        [4150, -1, 170], [4380, -1, 130], [4560, 1, 200], [4780, 1, 120],
        [5050, -1, 160], [5420, -1, 80], [5430, 1, 80],
      ],
      // The 1955 high-speed oval: shares the main straight, banks round both
      // ends and crosses over the circuit between Lesmo and Ascari.
      oval: {
        width: 12,
        bank: 6,
        points: [[-396, 19], [-532, 23], [-634, 25], [-690, 31], [-747, 50], [-783, 84], [-809, 146], [-821, 225], [-823, 304], [-817, 395], [-801, 463], [-775, 525], [-741, 580], [-696, 624], [-639, 653], [-572, 669], [-487, 675], [-215, 672], [125, 669], [464, 666], [634, 662], [690, 656], [747, 638], [804, 601], [849, 556], [889, 503], [917, 452], [934, 384], [939, 304], [930, 248], [905, 186], [866, 123], [821, 75], [770, 35], [724, 10], [679, -10], [623, -18], [351, -8], [11, 7]],
      },
      fields: [
        { kind: 'lawn', poly: [[-481, 338], [-306, 336], [-303, 650], [-479, 653]] },
        { kind: 'orchard', poly: [[-303, 336], [-147, 334], [-145, 646], [-301, 650]] },
        { kind: 'lawn', poly: [[-141, 334], [136, 329], [138, 644], [-139, 646]] },
        { kind: 'plantation', poly: [[140, 329], [441, 325], [444, 642], [143, 644]] },
        { kind: 'lawn', poly: [[-634, -109], [-487, -109], [-487, -58], [-634, -58]] },
        { kind: 'lawn', poly: [[939, -216], [1098, -216], [1098, -92], [939, -92]] },
      ],
      roads: [
        { points: [[238, 249], [577, 244], [939, 240], [1324, 234]], width: 7 },
        { points: [[-340, 299], [-340, 672]], width: 6, trees: true },
        { points: [[-487, -43], [11, -46], [690, -62], [1087, -71]], width: 6 },
        { points: [[1087, -71], [1211, -92], [1404, -80], [1517, -1]], width: 6 },
      ],
      // Golf course south of the park, fairways fanning across it.
      golf: { poly: [[-1053, 714], [690, 698], [917, 757], [1064, 961], [1132, 1209], [-1053, 1209]], holes: 16, heading: -0.5 },
      // Town edges to the north.
      town: [
        { poly: [[-1121, -431], [-747, -431], [-747, -324], [-1121, -324]] },
        { poly: [[-328, -431], [11, -431], [11, -363], [-328, -363]] },
        { poly: [[441, -431], [917, -431], [917, -312], [441, -312]] },
        { poly: [[1426, -431], [1795, -431], [1795, -58], [1426, -58]] },
      ],
    },
  },
];

export function getTrack(id) {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}

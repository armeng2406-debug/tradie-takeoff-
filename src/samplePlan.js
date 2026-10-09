export const SAMPLE_WIDTH = 1200;
export const SAMPLE_HEIGHT = 850;

const toilet = (x, y, ref, scale = 1) => `
  <g transform="translate(${x} ${y}) scale(${scale})" stroke="#526272" stroke-width="2" fill="#fff">
    <rect x="-18" y="-24" width="36" height="19" rx="3" fill="#eef2f5"/>
    <ellipse cx="0" cy="8" rx="20" ry="24"/>
    <ellipse cx="0" cy="8" rx="10" ry="14" fill="#f7f9fa" stroke="#9aa7b2" stroke-width="1.3"/>
    <path d="M-7 -16v5h14v-5" fill="none" stroke="#9aa7b2" stroke-width="1.3"/>
    <text x="0" y="43" fill="#647484" stroke="none" text-anchor="middle" font-size="10" font-weight="700">${ref}</text>
  </g>`;

const basin = (x, y, ref, scale = 1) => `
  <g transform="translate(${x} ${y}) scale(${scale})" stroke="#526272" stroke-width="2" fill="#fff">
    <rect x="-24" y="-19" width="48" height="37" rx="7"/>
    <ellipse cx="0" cy="-1" rx="15" ry="10" fill="#f7f9fa" stroke="#a6b1ba" stroke-width="1.2"/>
    <circle cx="0" cy="-1" r="2" fill="#718291" stroke="none"/>
    <path d="M-18 18v5m36-5v5" stroke-width="1.4"/>
    <text x="0" y="37" fill="#647484" stroke="none" text-anchor="middle" font-size="10" font-weight="700">${ref}</text>
  </g>`;

const floorWaste = (x, y, ref, scale = 1) => `
  <g transform="translate(${x} ${y}) scale(${scale})" stroke="#526272" stroke-width="1.7" fill="#fff">
    <rect x="-15" y="-15" width="30" height="30" rx="2"/>
    <path d="M-10 -10 10 10M10 -10-10 10M0-13v26M-13 0h26" stroke="#8795a1" stroke-width="1.2"/>
    <circle r="2.4" fill="#526272" stroke="none"/>
    <text x="0" y="27" fill="#647484" stroke="none" text-anchor="middle" font-size="9" font-weight="700">${ref}</text>
  </g>`;

const basePage = (title, sheet) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="${SAMPLE_WIDTH}" height="${SAMPLE_HEIGHT}" viewBox="0 0 ${SAMPLE_WIDTH} ${SAMPLE_HEIGHT}">
    <rect width="1200" height="850" fill="#fff"/>
    <rect x="28" y="24" width="1144" height="802" fill="none" stroke="#73808b" stroke-width="1.4"/>
    <text x="55" y="60" fill="#253747" font-family="Arial,sans-serif" font-size="19" font-weight="700">${title}</text>
    <text x="55" y="82" fill="#73808b" font-family="Arial,sans-serif" font-size="10">OAK STREET RENOVATION  ·  PERMIT REVIEW SAMPLE  ·  DO NOT SCALE</text>
    <line x1="55" y1="96" x2="1145" y2="96" stroke="#c5cdd3" stroke-width="1"/>
    <rect x="927" y="772" width="245" height="54" fill="#f8fafb" stroke="#84909a" stroke-width="1"/>
    <line x1="927" y1="799" x2="1172" y2="799" stroke="#aeb8c0"/>
    <line x1="1046" y1="772" x2="1046" y2="826" stroke="#aeb8c0"/>
    <text x="939" y="789" fill="#65727d" font-family="Arial,sans-serif" font-size="9" font-weight="700">SHEET</text>
    <text x="939" y="818" fill="#2b3c4c" font-family="Arial,sans-serif" font-size="14" font-weight="700">${sheet}</text>
    <text x="1058" y="790" fill="#65727d" font-family="Arial,sans-serif" font-size="9" font-weight="700">ISSUE</text>
    <text x="1058" y="811" fill="#2b3c4c" font-family="Arial,sans-serif" font-size="11" font-weight="700">V1 · SAMPLE</text>
`;

function pageOneSvg() {
  const fixtures = [
    toilet(393, 280, 'WC-01'),
    toilet(705, 280, 'WC-02'),
    toilet(393, 535, 'WC-03'),
    basin(248, 280, 'BAS-01'),
    basin(556, 535, 'BAS-02'),
    floorWaste(604, 420, 'FW-01'),
    floorWaste(755, 535, 'FW-02'),
  ].join('');
  return `${basePage('PLUMBING FIXTURE PLAN · GROUND FLOOR', 'P-01')}
    <g fill="none" stroke="#455664" stroke-width="4" stroke-linecap="square">
      <path d="M94 133H810V680H94z"/>
      <path d="M94 350H810M485 133V350M485 350V680M650 133V350M650 350V455M650 493V680M94 470H270M270 470V680"/>
      <path d="M94 350h46m36 0h56M485 470h54m42 0h53M650 350h53m45 0h62" stroke-width="3"/>
    </g>
    <g fill="none" stroke="#c4ccd2" stroke-width="1.2">
      <path d="M117 158h160v154H117zM520 158h105v154H520zM675 158h112v154H675zM117 379h135v73H117zM292 379h168v275H292zM520 379h105v275H520zM675 512h112v142H675z"/>
      <path d="M139 180h120M139 200h95M543 180h61M697 180h66M314 401h120M542 401h62M696 534h67" stroke-dasharray="3 4"/>
    </g>
    <g fill="#607080" font-family="Arial,sans-serif" font-size="9" text-anchor="middle">
      <text x="197" y="329">ENSUITE 01</text><text x="572" y="329">WC 02</text><text x="731" y="329">BATHROOM</text>
      <text x="183" y="455">LAUNDRY</text><text x="375" y="651">HALL / SERVICES</text><text x="572" y="651">WC 03</text><text x="730" y="651">BATHROOM</text>
    </g>
    <g fill="none" stroke="#117c73" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" opacity=".68">
      <path d="M150 397H324V285H393M324 285H248M324 397V535H393M324 535H556M324 420H604M556 535H755"/>
    </g>
    <g fill="#117c73" stroke="#fff" stroke-width="1.5">
      <circle cx="150" cy="397" r="4"/><circle cx="324" cy="397" r="4"/><circle cx="324" cy="535" r="4"/><circle cx="556" cy="535" r="4"/>
    </g>
    ${fixtures}
    <g font-family="Arial,sans-serif">
      <rect x="844" y="132" width="298" height="214" rx="3" fill="#fbfcfd" stroke="#8b98a2"/>
      <rect x="844" y="132" width="298" height="27" fill="#edf1f4" stroke="#8b98a2"/>
      <text x="858" y="150" fill="#334657" font-size="10" font-weight="700">FIXTURE SCHEDULE · TYPICAL UNITS</text>
      <text x="858" y="177" fill="#657482" font-size="9">ITEM</text><text x="1096" y="177" fill="#657482" font-size="9" text-anchor="end">SCHEDULE QTY</text>
      <line x1="856" y1="184" x2="1130" y2="184" stroke="#d3dbe0"/>
      <text x="858" y="204" fill="#334657" font-size="10">Water closet (WC)</text><text x="1114" y="204" fill="#334657" font-size="10" text-anchor="end">4 TYP.</text>
      <text x="858" y="229" fill="#334657" font-size="10">Basin (BAS)</text><text x="1114" y="229" fill="#334657" font-size="10" text-anchor="end">4 TYP.</text>
      <text x="858" y="254" fill="#334657" font-size="10">Floor waste (FW)</text><text x="1114" y="254" fill="#334657" font-size="10" text-anchor="end">2</text>
      <line x1="856" y1="267" x2="1130" y2="267" stroke="#d3dbe0"/>
      <text x="858" y="286" fill="#8c5d12" font-size="9" font-weight="700">SCHEDULE / TYPICAL REFERENCE — NOT A PLAN COUNT</text>
      <text x="858" y="306" fill="#768491" font-size="9">Count distinct physical symbols on the plan only.</text>
      <text x="858" y="322" fill="#768491" font-size="9">Detail P-02 repeats WC-01 and BAS-01.</text>
      <rect x="844" y="367" width="298" height="121" rx="3" fill="#fbfcfd" stroke="#8b98a2"/>
      <rect x="844" y="367" width="298" height="24" fill="#edf1f4" stroke="#8b98a2"/>
      <text x="858" y="384" fill="#334657" font-size="10" font-weight="700">GENERAL NOTES</text>
      <text x="858" y="411" fill="#647482" font-size="9">1. Provide 4 WCs and 4 basins typical.</text>
      <text x="858" y="430" fill="#647482" font-size="9">2. Fixture schedule is not a verified takeoff.</text>
      <text x="858" y="449" fill="#647482" font-size="9">3. Verify material, size and route on site.</text>
      <text x="858" y="468" fill="#647482" font-size="9">4. Dimensions are indicative for this sample.</text>
    </g>
    <g fill="none" stroke="#6d7a84" stroke-width="1.3">
      <path d="M165 732v13M765 732v13M165 740h600"/>
      <path d="m165 740 10-4v8zM765 740l-10-4v8z" fill="#6d7a84" stroke="none"/>
    </g>
    <rect x="422" y="724" width="86" height="21" fill="#fff"/>
    <text x="465" y="739" fill="#40515e" font-family="Arial,sans-serif" font-size="11" font-weight="700" text-anchor="middle">6,000 mm</text>
    <text x="65" y="790" fill="#84909a" font-family="Arial,sans-serif" font-size="9">REFERENCE DIMENSION FOR CALIBRATION: 165,740 TO 765,740 = 6,000 mm</text>
  </svg>`;
}

function pageTwoSvg() {
  return `${basePage('PLUMBING DETAIL · ENSUITE 01', 'P-02')}
    <g fill="#71808d" font-family="Arial,sans-serif" font-size="10">
      <text x="74" y="127" font-size="11" font-weight="700">DETAIL A · ENLARGED REFERENCE VIEW</text>
      <text x="74" y="147">These symbols are repeated views of physical fixtures already shown on P-01.</text>
    </g>
    <g fill="none" stroke="#455664" stroke-width="5" stroke-linecap="square">
      <path d="M130 205H728V636H130z"/>
      <path d="M464 205V636M130 429H464"/>
      <path d="M130 429h53m36 0h54M464 429h95m44 0h125" stroke-width="3"/>
    </g>
    <g fill="none" stroke="#c4ccd2" stroke-width="1.3">
      <path d="M159 235h263v166H159zM497 235h194v166H497zM159 462h263v145H159zM497 462h194v145H497z"/>
      <path d="M178 255h220M517 255h150M178 481h220M517 481h150" stroke-dasharray="4 4"/>
    </g>
    <g fill="#607080" font-family="Arial,sans-serif" font-size="10" text-anchor="middle">
      <text x="290" y="389">ENSUITE 01 · PLAN DETAIL</text><text x="594" y="389">SHOWER / SERVICE ZONE</text>
    </g>
    ${toilet(318, 293, 'WC-01', 1.55)}
    ${basin(580, 534, 'BAS-01', 1.45)}
    <g fill="none" stroke="#117c73" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" opacity=".68">
      <path d="M164 516H310V293M310 516H580"/>
    </g>
    <g fill="#fff" stroke="#117c73" stroke-width="2"><circle cx="164" cy="516" r="5"/><circle cx="310" cy="516" r="5"/></g>
    <g font-family="Arial,sans-serif">
      <rect x="792" y="203" width="321" height="194" rx="4" fill="#fff9eb" stroke="#bd9855"/>
      <circle cx="817" cy="231" r="11" fill="#fff" stroke="#a87a28" stroke-width="1.5"/><text x="817" y="235" fill="#835e1d" font-size="12" font-weight="700" text-anchor="middle">i</text>
      <text x="838" y="235" fill="#6f511d" font-size="11" font-weight="700">REPEATED VIEW — DO NOT ADD AGAIN</text>
      <text x="813" y="269" fill="#776647" font-size="10">WC-01 and BAS-01 are the same physical items</text>
      <text x="813" y="288" fill="#776647" font-size="10">as on sheet P-01. This detail is not extra quantity.</text>
      <text x="813" y="327" fill="#776647" font-size="9">The sample finder links the repeated fixture references</text>
      <text x="813" y="344" fill="#776647" font-size="9">and collapses them before review.</text>
      <rect x="792" y="426" width="321" height="112" rx="4" fill="#f8fafb" stroke="#aab4bc"/>
      <text x="812" y="453" fill="#485c6e" font-size="10" font-weight="700">MEASUREMENT NOTE</text>
      <text x="812" y="480" fill="#71808d" font-size="9">No scale is supplied for this detail sheet.</text>
      <text x="812" y="499" fill="#71808d" font-size="9">Set a separate page calibration before measuring</text>
      <text x="812" y="516" fill="#71808d" font-size="9">any run here. Counts do not need calibration.</text>
    </g>
  </svg>`;
}

export const SAMPLE_PAGES = [pageOneSvg(), pageTwoSvg()];

// Manually checked sample ground truth. detail-view occurrences share physicalId.
export const SAMPLE_FIXTURES = [
  { page: 1, physicalId: 'WC-01', category: 'toilet', x: 393 / SAMPLE_WIDTH, y: 280 / SAMPLE_HEIGHT, ref: 'WC-01' },
  { page: 1, physicalId: 'WC-02', category: 'toilet', x: 705 / SAMPLE_WIDTH, y: 280 / SAMPLE_HEIGHT, ref: 'WC-02' },
  { page: 1, physicalId: 'WC-03', category: 'toilet', x: 393 / SAMPLE_WIDTH, y: 535 / SAMPLE_HEIGHT, ref: 'WC-03' },
  { page: 1, physicalId: 'BAS-01', category: 'basin', x: 248 / SAMPLE_WIDTH, y: 280 / SAMPLE_HEIGHT, ref: 'BAS-01' },
  { page: 1, physicalId: 'BAS-02', category: 'basin', x: 556 / SAMPLE_WIDTH, y: 535 / SAMPLE_HEIGHT, ref: 'BAS-02' },
  { page: 1, physicalId: 'FW-01', category: 'floor-waste', x: 604 / SAMPLE_WIDTH, y: 420 / SAMPLE_HEIGHT, ref: 'FW-01' },
  { page: 1, physicalId: 'FW-02', category: 'floor-waste', x: 755 / SAMPLE_WIDTH, y: 535 / SAMPLE_HEIGHT, ref: 'FW-02' },
  { page: 2, physicalId: 'WC-01', category: 'toilet', x: 318 / SAMPLE_WIDTH, y: 293 / SAMPLE_HEIGHT, ref: 'WC-01 · repeated view' },
  { page: 2, physicalId: 'BAS-01', category: 'basin', x: 580 / SAMPLE_WIDTH, y: 534 / SAMPLE_HEIGHT, ref: 'BAS-01 · repeated view' },
];

export const SAMPLE_REFERENCE_COUNTS = Object.freeze({ toilet: 3, basin: 2, 'floor-waste': 2 });

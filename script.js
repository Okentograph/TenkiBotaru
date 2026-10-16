// =============================================================
//  天気螢 ― 一年の天気の軌道
//  コンピュータ基礎II 課題2
//
//  Open-Meteo から取得した、ある都市の2000〜2024年の「日ごとの気温・降水・日照」を
//  読み、1日を3次元空間の1点（X=日照, Y=気温, Z=降水）に置く。
//  1年分の365の点を日付の順にゆるい曲線で結ぶと、その土地の一年が
//  空間の中の「軌道」になる。画面の下で選んだ年（複数可）の軌道に沿って
//  無数の光の粒子を流し、粒子の残す線の重なりとして描く。
//  別の年を選ぶと、光の粒子は同じ日付のまま、1秒かけてその年の軌道へ移る。
//
//  作り方（ジェネラティブのプロセス）
//   1. データ   … 1日 = 気温・降水・日照の3つの数値
//   2. 描画単位 … 1日 = 3次元空間の1点
//   3. 軌跡     … 365点を日付順に曲線（Catmull-Rom）でゆるく結ぶ
//   4. 光の糸   … 数千の粒子が、軌道を囲む8重の輪に等間隔に並び、
//                  らせんを描きながら流れて光の線を残す（乱数は使わない）
//                  天気の変化が大きい日 → 粒子が速く流れる
//                  気温 → 線の色（低い 青 → 高い 赤）
//                  降水 → 線の太さ（雨の多い時期ほど太い）
//                  日照 → 線の明るさ（日が長いほど明るく、短いほど暗い）
//                  ※ 色・太さ・明るさは、その都市の25年分の中での高い低いで決める
//                    （位置は全都市共通の固定のものさし）
//   5. 視点     … 軌道のまわりをゆっくり回り続ける（手では回さず、見る人は年を選ぶだけ）
//   6. 軸       … 中央に3本の軸と、基準の値（気温・日照・降水）を薄く書く
//   7. 都市と年 … 上の都市名・下の2000〜2024年から選ぶ（複数可）。
//                  年が変わると、光が同じ日付のまま新しい軌道へ流れ移る
//
//  複数の都市を同じ空間に重ねると、土地による一年の違いを比べられる。
//  描くデータは Open-Meteo から取得したものだけを使う。
//
//  形・色・線の太さ・明るさ・流れる速さはすべてデータで決まり、乱数は使わない。
//  都市が変わると軌道の形が変わり、同じ都市なら何度開いても同じ絵になる。
//
//  キー操作（画面には出していない）
//   スペース：一時停止 / ← →：前の年・次の年 / S：PNG保存
//  都市（画面の上）と年（画面の下）は同じ操作で選ぶ
//   パソコン：クリック / Shift＋クリックで足す・外す / ドラッグで範囲
//   スマホ　：タップ / 長押しで足す・外す / スワイプで範囲
// =============================================================

const PARTICLES = 1600; // 1都市・1年の軌道に流す粒子の数
const MAX_PARTICLES = 9000; // 年や都市を重ねたときの、粒子の数の上限（動きが重くならないように）
const MORPH_MS = 1000; // 年を変えたとき、光が新しい軌道へ移るのにかける時間（ミリ秒）
const SMOOTH_DAYS = 10; // 曲線をゆるくするための移動平均の幅（前後の日数）
const FADE = 0.045; // 残像の消える速さ（小さいほど長く残る）
const AUTO_TURN = 0.0018; // 自動で回る速さ（ラジアン／フレーム）
// スマホなど小さな画面では、粒子と画素を減らして動きを軽くする
const SMALL = Math.min(window.innerWidth, window.innerHeight) < 600;
const DENSITY = SMALL ? 0.45 : 1;
const LINE_WIDTH = 2.2; // 線の太さの基準（画面の点の数）。降水に応じて 0.3〜4倍になる
const CORE = 0.45; // 線の芯（細く明るい部分）の太さの割合。太い線もぼけずに見せる

// 3つの軸の範囲（どの都市も同じものさしで比べられるよう固定する）
const TEMP_RANGE = [-55, 40]; // 気温（℃）。ヤクーツクの冬（-52℃台）からメッカの夏まで入る範囲
const RAIN_MAX = 30; // 降水（mm/日）。これより多い日は30mmとして扱う
const RAIN_AXIS_MAX = 10; // 降水の軸の最大（mm/日）。これを超える時期は軸の外へはみ出す
const RAIN_CENTER = 3; // 降水の軸の中央に来る値（mm/日）
// 0mm・3mm・10mm が軸の端・中央・端に並ぶよう、べき乗で縮める（(3/10)^RAIN_POWER = 0.5）
const RAIN_POWER = Math.log(0.5) / Math.log(RAIN_CENTER / RAIN_AXIS_MAX);
const SUN_MAX = 14; // 日照（時間/日）。これより長い日は14時間として扱う
const SUN_AXIS_MIN = 4; // 日照の軸の最小（時間/日）
const SUN_AXIS_MAX = 12; // 日照の軸の最大（時間/日）

// 色（RGBの数値で指定）
const COLD = [50, 110, 255];
const MILD = [190, 120, 255];
const HOT = [255, 70, 40];
const BACK = [4, 5, 9]; // 背景（夜空）

const canvas = document.getElementById("sky");
const ctx = canvas.getContext("2d");
const axesCanvas = document.getElementById("axes"); // 軸と目盛りだけを描く透明な重ね板
const actx = axesCanvas.getContext("2d");
const info = document.getElementById("info");
const cityBar = document.getElementById("cities");
const yearBar = document.getElementById("years");

// 画面の画素の細かさ（高精細の画面でも2倍までにして、重くなりすぎないようにする）
function pixelRatio() {
  return Math.min(2, window.devicePixelRatio || 1);
}

// ---------------------------------------------------------------
//  データ：Open-Meteo の過去気象API から取得した、2000〜2024年の
//  日ごとの気温・降水・日照（weather-data.js）を読む。
//  Open-Meteo の無料枠には回数制限があり、25年分×都市数を開くたびに
//  取りに行くと断られる（HTTP 429）。そこで fetch-data.html で一度だけ
//  ゆっくり取得して保存し、作品はその保存データで描く。
// ---------------------------------------------------------------
async function loadWeather(city) {
  // 条件分岐：weather-data.js がない、またはその都市がまだ取得されていない
  if (typeof WEATHER_DATA === "undefined" || !WEATHER_DATA[city.id]) {
    throw new Error(`${city.name}のデータがまだありません。fetch-data.html で取得してください`);
  }
  const saved = WEATHER_DATA[city.id];
  const first = new Date(`${saved.start}T00:00:00Z`);
  let days = saved.temp.map((temp, i) => ({
    date: new Date(first.getTime() + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    temp: temp,
    rain: saved.rain[i],
    sun: saved.sun[i],
  }));
  // 最初と最後の、値が欠けている日を除く（間の欠けは fillGaps で埋める）
  const firstDay = days.findIndex(complete);
  const lastDay = days.length - 1 - [...days].reverse().findIndex(complete);
  if (firstDay < 0) throw new Error(`${city.name}のデータに値がありません`);
  days = days.slice(firstDay, lastDay + 1);
  return { days: fillGaps(days), source: "Open-Meteo" };
}

// 1日の3つの値がすべてそろっているか
function complete(day) {
  return ["temp", "rain", "sun"].every((key) => typeof day[key] === "number");
}

// 欠けている値（null）を前日の値で埋める
function fillGaps(days) {
  for (let i = 0; i < days.length; i++) {
    for (const key of ["temp", "rain", "sun"]) {
      if (days[i][key] === null || Number.isNaN(days[i][key])) {
        days[i][key] = i > 0 ? days[i - 1][key] : 0;
      }
    }
  }
  return days;
}

// ---------------------------------------------------------------
//  1日 → 3次元の点・色・線の太さ・明るさ
// ---------------------------------------------------------------
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

// 日照・気温・降水を 0〜1 にそろえる（並び順が X・Y・Z になる）
// 気温を高さ（Y）にして、暑い時期ほど上に昇るようにする
function normalize(day) {
  const t = (day.temp - TEMP_RANGE[0]) / (TEMP_RANGE[1] - TEMP_RANGE[0]);
  const r = Math.pow(Math.min(day.rain, RAIN_MAX) / RAIN_AXIS_MAX, RAIN_POWER);
  const s = Math.min(day.sun, SUN_MAX) / SUN_MAX;
  // 降水は1（10mm）を超えてもそのまま（大雨の時期は軸の外へはみ出す）
  return [clamp01(s), clamp01(t), r];
}

// 気温の色：青 → 紫 → 赤
function tempColor(t) {
  t = clamp01(t);
  return t < 0.5 ? mix(COLD, MILD, t * 2) : mix(MILD, HOT, (t - 0.5) * 2);
}

// 前後 SMOOTH_DAYS 日の重み付き平均（近い日ほど重い）で、変化をゆるくする
function smooth(values) {
  return values.map((_, i) => {
    const sum = new Array(values[0].length).fill(0);
    let weight = 0;
    for (let k = -SMOOTH_DAYS; k <= SMOOTH_DAYS; k++) {
      // 一年を輪として扱い、12月末と1月初めもつないでならす
      const j = (i + k + values.length) % values.length;
      const w = SMOOTH_DAYS + 1 - Math.abs(k);
      for (let a = 0; a < sum.length; a++) sum[a] += values[j][a] * w;
      weight += w;
    }
    return sum.map((v) => v / weight);
  });
}

// 何年分もの日々を、1年ずつに分ける（{ "2000": [...], "2001": [...], ... }）
function splitYears(days) {
  const years = {};
  for (const day of days) {
    const y = day.date.slice(0, 4);
    (years[y] = years[y] || []).push(day);
  }
  // 条件分岐：途中で終わっている年（データが半年もない年）は軌道にしない
  for (const y in years) {
    if (years[y].length <= 180) delete years[y];
  }
  return years;
}

// 1日ごとの値を 0〜1 にそろえ、ゆるくならした道すじ
function makePath(days) {
  return smooth(days.map(normalize));
}

// 表示している都市の、すべての年の軌道が収まる範囲
// （年を変えても軸が動かず、都市どうしも比べられるよう、ものさしを共有する）
function makeSpace(paths) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const path of paths) {
    for (const n of path) {
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], n[a]);
        hi[a] = Math.max(hi[a], n[a]);
      }
    }
  }
  return { lo, hi };
}

// 固定のものさし：8都市・25年の道すじから、最初に一度だけ決める
// （どの都市・年を選んでも軸と目盛りが変わらず、都市ごとの差がそのまま大きさの差になる）
let fixedSpace = null;
async function loadFixedSpace() {
  if (fixedSpace) return fixedSpace;
  const paths = [];
  for (const city of CITIES) {
    const key = city.id;
    if (!weatherCache[key]) weatherCache[key] = loadWeather(city);
    const byYear = splitYears((await weatherCache[key]).days);
    for (const y in byYear) paths.push(makePath(byYear[y]));
  }
  fixedSpace = makeSpace(paths);
  // 気温は 0℃ が中心になるよう、いちばん暑い都市の夏の気温で上下対称にする
  // （ヤクーツクの真冬のような極端な寒さは、軸の外へはみ出してもよい）
  const span = TEMP_RANGE[1] - TEMP_RANGE[0];
  const hottest = TEMP_RANGE[0] + fixedSpace.hi[1] * span;
  fixedSpace.lo[1] = (-hottest - TEMP_RANGE[0]) / span;
  fixedSpace.hi[1] = (hottest - TEMP_RANGE[0]) / span;
  // 降水は 0〜10mm を軸の範囲にする（10mmを超える大雨の時期は、軸の外へはみ出してよい）
  fixedSpace.lo[2] = 0;
  fixedSpace.hi[2] = AXES[2].toNorm(RAIN_AXIS_MAX); // = 1（3mm がちょうど中央の 0.5）
  // 日照は 4〜12時間 を軸の範囲にする（8時間が中央。4時間より短い時期と12時間を超える時期ははみ出す）
  fixedSpace.lo[0] = AXES[0].toNorm(SUN_AXIS_MIN);
  fixedSpace.hi[0] = AXES[0].toNorm(SUN_AXIS_MAX);
  return fixedSpace;
}

// space：形を決める固定のものさし（全都市共通）
// own：色・太さ・明るさを決める、その都市の25年分の幅（都市ごとに違う）
function buildOrbit(path, space, own) {
  // 形：固定のものさしで、-1〜1 の立方体に置く（都市の差がそのまま位置の差になる）
  const lo = space.lo;
  const hi = space.hi;
  const points = path.map((n) =>
    n.map((v, a) => ((v - lo[a]) / Math.max(hi[a] - lo[a], 0.05)) * 1.8 - 0.9)
  );

  // その都市の中で、どのくらい高いか（0〜1）
  const relative = (n, a) => clamp01((n[a] - own.lo[a]) / Math.max(own.hi[a] - own.lo[a], 0.01));

  // 色：その都市にとって暑い時期ほど赤く、寒い時期ほど青く
  // （メッカの冬もヤクーツクの夏も、その土地の季節として色が変わる）
  const colors = path.map((n) => tempColor(relative(n, 1)));

  // 線の太さ：その都市にとって雨の多い時期ほど太く（基準の0.3〜4倍）
  const thickness = path.map((n) => 0.3 + 3.7 * relative(n, 2));

  // 明るさ：その都市にとって日の長い時期ほど明るく、短い時期ほど暗く
  const brightness = path.map((n) => 0.15 + 1.1 * relative(n, 0));

  // 流れる速さ：1日で軌道が大きく動く（天気が大きく変わる）ところほど速く
  const steps = points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  });
  const meanStep = steps.reduce((sum, v) => sum + v, 0) / steps.length || 1;
  const pace = steps.map((v) => 0.6 + 0.8 * clamp01(v / (meanStep * 2)));

  return { points, colors, thickness, brightness, pace };
}

// 一年の長さ（日）。u はこの長さで一周し、12月31日の次は1月1日へなめらかにつながる
const YEAR = 365;

// u（0〜YEAR の小数の日）を、その年の点の番号（うるう年は366点）に直す。範囲の外は輪のように回り込む
function dayIndex(n, u) {
  const f = (u * n) / YEAR;
  return ((f % n) + n) % n;
}

// Catmull-Rom 曲線：u 日目の位置の点を求める（一年を輪として、12月末と1月初めもつなぐ）
function curvePoint(points, u) {
  const n = points.length;
  const f = dayIndex(n, u);
  const i = Math.floor(f);
  const t = f - i;
  const p0 = points[(i - 1 + n) % n];
  const p1 = points[i % n];
  const p2 = points[(i + 1) % n];
  const p3 = points[(i + 2) % n];
  const out = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    out[a] =
      0.5 *
      (2 * p1[a] +
        (-p0[a] + p2[a]) * t +
        (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t * t +
        (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t * t * t);
  }
  return out;
}

// 日ごとの値の配列から、u（小数の日）の位置の値を直線で補う
function valueAt(list, u) {
  const f = dayIndex(list.length, u);
  const i = Math.floor(f) % list.length;
  const j = (i + 1) % list.length; // 12月31日の次は1月1日
  const t = f - Math.floor(f);
  if (Array.isArray(list[i])) return mix(list[i], list[j], t);
  return list[i] + (list[j] - list[i]) * t;
}

// ---------------------------------------------------------------
//  粒子：軌道のまわりを、らせんを描きながら流れる
// ---------------------------------------------------------------

// 粒子は軌道を囲む RINGS 重の輪に、等間隔に並べる（乱数は使わない）
const RINGS = 8;

// layer：粒子が流れる都市 / chosenYears：選んでいる年 / count：この都市に流す粒子の数
// 粒子は選んだ年に順番に配る（k番目の粒子は chosenYears[k % 年の数] の軌道を流れる）
function createParticles(layer, chosenYears, count) {
  const slots = Math.ceil(count / RINGS); // 1つの輪に並ぶ粒子の数
  const dayCount = YEAR;
  const list = [];
  for (let k = 0; k < count; k++) {
    const ring = k % RINGS; // 内側から何番目の輪か
    const slot = Math.floor(k / RINGS); // 輪の中で何番目か
    list.push({
      layer: layer, // どの都市の軌道を流れるか
      year: chosenYears[k % chosenYears.length], // どの年の軌道を流れるか
      from: null, // 年や都市を変えた直後：移ってくる元の軌道 { layer, year }
      // 一年に等間隔に並べ、輪ごとに少しずらして重ならないようにする
      // u は「1月1日から何日目か」。年を変えても同じ日付のまま移る
      u: (((slot + ring / RINGS) / slots) * dayCount) % dayCount,
      speed: 0.05 + 0.012 * ring, // 外側の輪ほど少し速い（1フレームに進む日数）
      radius: 0.01 + 0.008 * ring, // 軌道からの離れ具合
      angle: (Math.PI * 2 * ring) / RINGS, // らせんの始まりの向き
      twist: ring % 2 === 0 ? 0.12 : -0.12, // 輪ごとに、らせんの向きを交互に変える
      alpha: 0.24 - 0.018 * ring, // 外側の輪ほど淡い
      prev: null, // 1フレーム前の3次元の位置
    });
  }
  return list;
}

// 軌道上の u 日目の位置に、らせんのずれを加えた3次元の位置
function particlePosition(orbit, p, u) {
  const c = curvePoint(orbit.points, u);
  const ahead = curvePoint(orbit.points, u + 0.5);
  // 進む向き（接線）
  let tx = ahead[0] - c[0];
  let ty = ahead[1] - c[1];
  let tz = ahead[2] - c[2];
  const len = Math.hypot(tx, ty, tz) || 1;
  tx /= len;
  ty /= len;
  tz /= len;
  // 接線に垂直な2つの向き（a と b）を外積で作る
  let ax = -tz;
  let az = tx;
  const alen = Math.hypot(ax, az) || 1;
  ax /= alen;
  az /= alen;
  const bx = ty * az;
  const by = tz * ax - tx * az;
  const bz = -ty * ax;
  const theta = p.angle + u * p.twist;
  const co = Math.cos(theta) * p.radius;
  const si = Math.sin(theta) * p.radius;
  return [c[0] + ax * co + bx * si, c[1] + by * si, c[2] + az * co + bz * si];
}

// ---------------------------------------------------------------
//  カメラ：3次元 → 画面（回転と遠近法）
// ---------------------------------------------------------------
const camera = {
  yaw: 0.6, // 左右の回り込み
  pitch: 0.45, // 上下の回り込み（見下ろす角度）
  zoom: 1,
};

function project(v) {
  const cy = Math.cos(camera.yaw);
  const sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch);
  const sp = Math.sin(camera.pitch);
  // Y軸まわりに回し（左右）、X軸まわりに傾ける（上下）
  const x = v[0] * cy - v[2] * sy;
  const z0 = v[0] * sy + v[2] * cy;
  const y = v[1] * cp + z0 * sp;
  const z = -v[1] * sp + z0 * cp;
  const depth = 3.4 / (3.4 + z); // 手前ほど大きく
  // 縦長の画面（スマホ）では横幅が狭いので、少し大きめに描く
  const fit = canvas.height > canvas.width ? 0.4 : 0.31;
  const scale = Math.min(canvas.width, canvas.height) * fit * depth * camera.zoom;
  return [canvas.width / 2 + x * scale, canvas.height / 2 - y * scale, depth];
}

// ---------------------------------------------------------------
//  軸：中央に X・Y・Z の線を1本ずつ引き、基準の値を薄く書く
// ---------------------------------------------------------------
// 各軸の「値 ⇄ 0〜1」の変換（normalize と同じものさし）と、目盛りの刻み
const AXES = [
  {
    name: "日照",
    unit: "時間",
    toNorm: (v) => v / SUN_MAX,
    fromNorm: (n) => n * SUN_MAX,
    nice: [4, 6, 8, 10, 12],
    center: 8, // 軸の中央の値（数値は書かない）
  },
  {
    name: "気温",
    unit: "℃",
    toNorm: (v) => (v - TEMP_RANGE[0]) / (TEMP_RANGE[1] - TEMP_RANGE[0]),
    fromNorm: (n) => TEMP_RANGE[0] + n * (TEMP_RANGE[1] - TEMP_RANGE[0]),
    steps: [5, 10, 20],
    center: 0,
  },
  {
    name: "降水",
    unit: "mm",
    toNorm: (v) => Math.pow(v / RAIN_AXIS_MAX, RAIN_POWER),
    fromNorm: (n) => Math.pow(Math.max(n, 0), 1 / RAIN_POWER) * RAIN_AXIS_MAX,
    // 降水はべき乗で縮めているので、等間隔ではなく切りのよい値を並べる（3mm が中央）
    nice: [0, 1, 3, 10],
    center: RAIN_CENTER,
  },
];

// 軸に使うものさし：都市を変えた直後は、前のものさしから少しずつ移る
function axisSpace() {
  const t = morphAmount();
  if (!fromSpace || t >= 1) return space;
  return { lo: mix(fromSpace.lo, space.lo, t), hi: mix(fromSpace.hi, space.hi, t) };
}

// 値 → その都市の軌道の座標（buildOrbit の広げ方と同じ計算）
function axisCoord(a, value) {
  const n = AXES[a].toNorm(value);
  const sp = axisSpace();
  return ((n - sp.lo[a]) / Math.max(sp.hi[a] - sp.lo[a], 0.05)) * 1.8 - 0.9;
}

// 目盛り：固定のものさしの範囲の中の、切りのよい値（例：気温なら -40℃・-20℃・0℃・20℃・40℃）
function pickTicks(a) {
  const axis = AXES[a];
  const sp = axisSpace();
  const min = axis.fromNorm(sp.lo[a]);
  const max = axis.fromNorm(sp.hi[a]);
  let ticks = [];
  if (axis.nice) {
    let from = 0;
    let to = axis.nice.length - 1;
    while (from < to && axis.nice[from + 1] <= min) from++;
    while (to > from && axis.nice[to - 1] >= max) to--;
    ticks = axis.nice.slice(from, to + 1);
  } else {
    // 条件分岐：目盛りが4つ以下になる、いちばん細かい刻みを選ぶ
    for (const step of axis.steps) {
      ticks = [];
      for (let v = Math.ceil((min - step / 2) / step) * step; v <= max + step / 2; v += step) {
        ticks.push(v);
      }
      if (ticks.length <= 4) break;
    }
  }
  // 軌道から離れすぎた目盛りは書かない
  return ticks.filter((v) => Math.abs(axisCoord(a, v)) <= 1.15);
}

function axisPoint(a, c) {
  const v = [0, 0, 0];
  v[a] = c;
  return v;
}

function drawAxes() {
  actx.clearRect(0, 0, axesCanvas.width, axesCanvas.height);
  if (!ready) return;
  const ratio = pixelRatio();
  actx.lineWidth = ratio;
  actx.font = `${11 * ratio}px "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif`;
  actx.textBaseline = "middle";
  for (let a = 0; a < 3; a++) {
    const ticks = pickTicks(a);
    // 軸の線：いちばん小さい目盛りから、大きい目盛りの少し先まで
    const ends = ticks.map((v) => axisCoord(a, v));
    const c0 = Math.min(...ends, -0.9);
    const c1 = Math.max(...ends, 0.9) + 0.3; // 軸の名前は、いちばん大きい目盛りから少し離して書く
    const p = project(axisPoint(a, c0));
    const q = project(axisPoint(a, c1));
    actx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    actx.beginPath();
    actx.moveTo(p[0], p[1]);
    actx.lineTo(q[0], q[1]);
    actx.stroke();
    // 目盛り：小さな点と値
    actx.fillStyle = "rgba(255, 255, 255, 0.4)";
    for (const value of ticks) {
      // 条件分岐：軸の中央（0℃・3mm・6時間）は、3本の軸が交わる所なので数値を書かない
      if (value === AXES[a].center) continue;
      const t = project(axisPoint(a, axisCoord(a, value)));
      actx.beginPath();
      actx.arc(t[0], t[1], 2 * ratio, 0, Math.PI * 2);
      actx.fill();
      actx.fillText(`${value}${AXES[a].unit}`, t[0] + 6 * ratio, t[1] - 8 * ratio);
    }
    // 軸の名前（値が大きくなる側の端）
    actx.fillStyle = "rgba(255, 255, 255, 0.55)";
    actx.fillText(AXES[a].name, q[0] + 6 * ratio, q[1]);
  }
  // 条件分岐：複数の軌道を重ねているときは、1月1日の位置に都市と年を書く
  if (layers.length > 1) {
    actx.fillStyle = "rgba(255, 255, 255, 0.7)";
    for (const layer of layers) {
      if (!layer.orbits) continue;
      const t = project(orbitOf(layer, chosen[chosen.length - 1]).points[0]);
      actx.fillText(`${CITIES[layer.city].name}`, t[0] + 8 * ratio, t[1]);
    }
  }
}

// ---------------------------------------------------------------
//  描画
// ---------------------------------------------------------------
// 表示する都市の一覧：{ city: CITIESの番号, source, orbits（年 → その年の軌道） }
let layers = [];
let space = null; // すべての軌道が共有するものさし
let fromSpace = null; // 前のものさし（ものさしは固定なので、ふだんは同じ）
let ready = false; // 軌道を描ける状態か
let years = []; // データのある年の一覧（例：["2000", …, "2024"]）
let chosen = ["2024"]; // 表示している年（複数可、古い順）
let morphStart = -Infinity; // 年を変えた時刻（ミリ秒）
let particles = [];
let paused = false;
let frame = 0; // 描いたフレームの数

function fitCanvas() {
  const ratio = pixelRatio();
  canvas.width = Math.floor(window.innerWidth * ratio);
  canvas.height = Math.floor(window.innerHeight * ratio);
  axesCanvas.width = canvas.width;
  axesCanvas.height = canvas.height;
  clearSky();
}

function clearSky() {
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgb(${BACK.join(",")})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  particles.forEach((p) => (p.prev = null));
}

// その都市の、ある年の軌道（その年のデータがなければ最後の年）
function orbitOf(layer, y) {
  return layer.orbits[y] || layer.orbits[years[years.length - 1]];
}

// 粒子が u 日目にいるときの、位置・色・明るさ・太さ・速さ
function sample(orbit, p, u) {
  const v = u;
  return {
    pos: particlePosition(orbit, p, v),
    color: valueAt(orbit.colors, v),
    light: valueAt(orbit.brightness, v),
    thick: valueAt(orbit.thickness, v),
    pace: valueAt(orbit.pace, v),
  };
}

// 2つの状態を t（0〜1）で混ぜる（年が変わる途中の姿）
function blend(a, b, t) {
  return {
    pos: mix(a.pos, b.pos, t),
    color: mix(a.color, b.color, t),
    light: a.light + (b.light - a.light) * t,
    thick: a.thick + (b.thick - a.thick) * t,
    pace: b.pace,
  };
}

// 年を変えてからの進み具合（0〜1）。ゆっくり動き出し、ゆっくり止まる
function morphAmount() {
  const t = Math.min(1, (performance.now() - morphStart) / MORPH_MS);
  return t * t * (3 - 2 * t);
}

// 1フレームぶん粒子を進め、光の線を draw(a, b, 色, 強さ, 太さ) で描く
function advance(draw) {
  const t = morphAmount();
  for (const p of particles) {
    let now = sample(orbitOf(p.layer, p.year), p, p.u);
    // 条件分岐：年を変えた直後は、前の年の同じ日の位置から少しずつ移る
    if (p.from !== null) {
      if (t < 1) now = blend(sample(orbitOf(p.from.layer, p.from.year), p, p.u), now, t);
      else p.from = null;
    }
    p.u += p.speed * now.pace;
    // 条件分岐：12月31日を過ぎたら1月1日に戻る（軌道は輪なので、線は途切れずなめらかにつながる）
    if (p.u >= YEAR) p.u -= YEAR;
    if (p.prev) {
      const a = project(p.prev);
      const b = project(now.pos);
      const k = p.alpha * b[2] * now.light;
      // 線の太さ：降水で決まる太さに、手前ほど太く見える遠近の効果をかける
      const width = LINE_WIDTH * (pixelRatio()) * now.thick * b[2];
      draw(a, b, now.color, k, width);
    }
    p.prev = now.pos;
  }
}

function drawLive() {
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(${BACK.join(",")}, ${FADE})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 薄い塗り重ねだけでは色の端数が消えきらず、もやが残るため、
  // ときどき少し濃く塗って夜空を黒に戻す
  frame++;
  if (frame % 4 === 0) {
    ctx.fillStyle = `rgba(${BACK.join(",")}, 0.2)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.globalCompositeOperation = "lighter"; // 光が重なるほど明るくなる
  ctx.lineCap = "round";
  advance((a, b, c, k, width) => {
    const rgb = `${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}`;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    // 太い線は、淡い外側と、細く明るい芯の2回で描く（ぼけずに輪郭が立つ）
    ctx.lineWidth = width;
    ctx.strokeStyle = `rgba(${rgb}, ${Math.min(1, k * 0.9)})`;
    ctx.stroke();
    ctx.lineWidth = Math.max(1, width * CORE);
    ctx.strokeStyle = `rgba(${rgb}, ${Math.min(1, k * 1.6)})`;
    ctx.stroke();
  });
}

function loop() {
  if (ready && !paused) {
    camera.yaw += AUTO_TURN; // いつもゆっくり回り続ける
    drawLive();
  }
  drawAxes();
  updateInfo();
  requestAnimationFrame(loop);
}

function updateInfo() {
  if (!ready) return;
  let state = "";
  if (paused) state = " ・ 一時停止";
  const sources = [...new Set(layers.map((l) => l.source))].join("・");
  info.textContent = `${yearText(chosen)}年 ・ データ：${sources}${state}`;
}

// 一度取得したデータは覚えておき、重ね直すたびに取りに行かない
const weatherCache = {};

// before：都市を選び直す前の { layers, particles, space }（はじめて描くときは null）
async function start(before = null) {
  cityPicker.render();
  info.textContent = "データを読み込んでいます…";
  try {
    const results = await Promise.all(
      layers.map((layer) => {
        const key = CITIES[layer.city].id;
        if (!weatherCache[key]) weatherCache[key] = loadWeather(CITIES[layer.city]);
        return weatherCache[key];
      })
    );
    // 各都市のデータを1年ずつの道すじに分ける（年 → 道すじ）
    const paths = results.map((r) => {
      const byYear = splitYears(r.days);
      const out = {};
      for (const y in byYear) out[y] = makePath(byYear[y]);
      return out;
    });
    // ものさしは固定（全都市・全年から決めたもの）。都市や年を変えても軸は動かない
    space = await loadFixedSpace();
    // どれかの都市にデータがある年を、画面の下に並べる
    years = [...new Set(paths.flatMap((byYear) => Object.keys(byYear)))].sort();
    chosen = chosen.filter((y) => years.includes(y));
    if (chosen.length === 0) chosen = [years[years.length - 1]];
    yearPicker.render();
    layers.forEach((layer, i) => {
      layer.source = results[i].source;
      layer.orbits = {};
      // 色・太さ・明るさは、その都市の25年分の幅の中で高い低いを決める
      const own = makeSpace(Object.values(paths[i]));
      for (const y in paths[i]) layer.orbits[y] = buildOrbit(paths[i][y], space, own);
    });
    particles = makeAllParticles();
    // 条件分岐：都市を選び直したときは、前の軌道から光が流れ移るようにする
    if (before && before.particles.length) {
      flowFrom(before);
    } else {
      fromSpace = null;
      clearSky();
    }
    ready = true;
    saveHash();
  } catch (error) {
    ready = false;
    // 取得に失敗した組み合わせは覚えておかない（次にまた取りに行く）
    for (const key in weatherCache) delete weatherCache[key];
    info.textContent = `描けませんでした（${error.message}）。`;
  }
}

// すべての都市の粒子を作る。粒子の数は、年が増えるほど増やす（上限 MAX_PARTICLES）
function makeAllParticles() {
  const per = DENSITY * Math.min(PARTICLES * Math.sqrt(chosen.length), MAX_PARTICLES / layers.length);
  const list = [];
  for (const layer of layers) list.push(...createParticles(layer, chosen, Math.round(per)));
  return list;
}

// 年の一覧を短く書く（例：2000〜2004・2010）
function yearText(list) {
  const parts = [];
  let i = 0;
  while (i < list.length) {
    let j = i;
    while (j + 1 < list.length && Number(list[j + 1]) === Number(list[j]) + 1) j++;
    parts.push(j > i ? `${list[i]}〜${list[j]}` : list[i]);
    i = j + 1;
  }
  return parts.join("・");
}

// URL を #tokyo,paris/2000-2004,2010 の形にしておく（開き直しても同じ都市と年になる）
function saveHash() {
  const list = layers.map((l) => CITIES[l.city].id).join(",");
  history.replaceState(null, "", `#${list}/${yearText(chosen).replace(/〜/g, "-").replace(/・/g, ",")}`);
}

// ---------------------------------------------------------------
//  選ぶ欄：画面の上に都市、画面の下に年を並べ、同じ操作で選ぶ
//   パソコン：クリック＝それだけ / Shift＋クリック＝足す・外す / ドラッグ＝範囲をまとめて
//   スマホ　：タップ＝それだけ / 長押し＝足す・外す / スワイプ（なぞる）＝範囲をまとめて
// ---------------------------------------------------------------
// bar：並べる場所 / keys()：並べる項目 / label(key)：表示する文字（HTML）
// current()：今選んでいる項目 / choose(list)：選び終えたときに呼ぶ
function makePicker(bar, keys, label, current, choose) {
  let drag = null; // ドラッグ中なら { from: 押した項目, to: 今の項目, shift: Shiftを押していたか }
  let pressTimer = 0; // 長押しを見分けるタイマー

  function render(preview) {
    const list = keys();
    if (bar.children.length !== list.length) {
      bar.innerHTML = "";
      for (const key of list) {
        const item = document.createElement("span");
        item.innerHTML = label(key);
        item.dataset.key = key;
        bar.appendChild(item);
      }
    }
    const lit = preview || current();
    for (const item of bar.children) {
      item.className = lit.includes(item.dataset.key) ? "active" : "";
    }
  }

  // ドラッグの始まりと今の位置から、選ぶ項目の一覧を作る（並び順のまま）
  function rangeTo(to) {
    const list = keys();
    const a = list.indexOf(drag.from);
    const b = list.indexOf(to);
    const range = list.slice(Math.min(a, b), Math.max(a, b) + 1);
    // 条件分岐：Shiftを押していれば、今の選択に足す
    return drag.shift ? list.filter((k) => range.includes(k) || current().includes(k)) : range;
  }

  function keyUnder(event) {
    const el = document.elementFromPoint(event.clientX, event.clientY);
    const item = el && el.closest("[data-key]");
    return item && item.parentNode === bar ? item.dataset.key : null;
  }

  bar.addEventListener("pointerdown", (event) => {
    const key = keyUnder(event);
    if (!key) return;
    drag = { from: key, to: key, shift: event.shiftKey };
    event.preventDefault();
    // 長押し：同じ項目を0.5秒押し続けたら、Shift＋クリックと同じく足す・外す
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      if (!drag || drag.to !== drag.from) return;
      drag.shift = true;
      finish();
    }, 500);
  });
  window.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const key = keyUnder(event);
    if (key && key !== drag.to) {
      drag.to = key;
      render(rangeTo(key)); // 離すまでは光らせて見せるだけ
    }
  });
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);

  // 指（マウス）を離したとき、または長押しが決まったときに、選ぶものを決める
  function finish() {
    clearTimeout(pressTimer);
    if (!drag) return;
    const { from, to, shift } = drag;
    const now = current();
    let next;
    if (from !== to) {
      next = rangeTo(to);
    } else if (shift) {
      // 条件分岐：Shift＋クリックは、選んでいれば外し、選んでいなければ足す（最後の1つは外さない）
      next = keys().filter((k) => (k === from ? !now.includes(k) : now.includes(k)));
      if (next.length === 0) next = now;
    } else {
      next = [from];
    }
    drag = null;
    render();
    // 条件分岐：選んだものが変わったときだけ描き直す
    if (next.join() !== now.join()) choose(next);
  }

  return { render };
}

// 画面の下：年（狭い画面では「20」を隠して下2桁だけ見せる）
const yearPicker = makePicker(
  yearBar,
  () => years,
  (y) => `<i>${y.slice(0, 2)}</i>${y.slice(2)}`,
  () => chosen,
  (list) => chooseYears(list)
);

// 画面の上：都市（選び直すと、ものさしと軌道を作り直す）
const cityPicker = makePicker(
  cityBar,
  () => CITIES.map((c) => c.id),
  (id) => CITIES.find((c) => c.id === id).name,
  () => layers.map((l) => CITIES[l.city].id),
  (ids) => {
    const before = ready ? { layers: layers, particles: particles, space: space } : null;
    layers = ids.map((id) => ({ city: CITIES.findIndex((c) => c.id === id) }));
    start(before);
  }
);

// 年を選ぶ：光の粒子は今いる日付のまま、1秒かけて新しい年の軌道へ移る
function chooseYears(next) {
  // 条件分岐：選んだ年が変わっていなければ何もしない
  if (!ready || next.join() === chosen.join()) return;
  const before = particles;
  chosen = next;
  particles = makeAllParticles();
  // 新しい粒子は、前に表示していた年のうち一番近い年の、同じ日付の位置から動き出す
  for (const layer of layers) {
    const shown = [...new Set(before.filter((q) => q.layer === layer).map((q) => q.year))];
    for (const p of particles) {
      if (p.layer !== layer) continue;
      const from = nearestYear(p.year, shown);
      p.from = from === p.year ? null : { layer: layer, year: from };
    }
  }
  fromSpace = null; // 年を変えても、ものさしは変わらない
  morphStart = performance.now();
  yearPicker.render();
  saveHash();
}

// 都市を選び直したとき、新しい粒子がどの軌道から移ってくるかを決める
//  ・続けて表示する都市の粒子は、同じ都市の前の軌道から
//    （ただし外した都市があれば、その都市の光の一部も流れ込む）
//  ・新しく足した都市の粒子は、前に表示していた都市の軌道から順番に
function flowFrom(before) {
  const old = before.layers;
  const keep = new Set(layers.map((l) => l.city));
  for (const layer of layers) {
    const same = old.find((l) => l.city === layer.city);
    let k = 0;
    for (const p of particles) {
      if (p.layer !== layer) continue;
      const pick = old[k % old.length];
      k++;
      const source = same && keep.has(pick.city) ? same : pick;
      // 前の都市の、同じ年（なければ一番近い年）の同じ日付の位置から
      const shown = Object.keys(source.orbits).filter((y) => chosen.includes(y));
      p.from = { layer: source, year: shown.includes(p.year) ? p.year : nearestYear(p.year, shown.length ? shown : Object.keys(source.orbits)) };
    }
  }
  fromSpace = before.space;
  morphStart = performance.now();
}

// 一覧の中から、y に一番近い年
function nearestYear(y, list) {
  let best = list[0];
  for (const c of list) {
    if (Math.abs(c - y) < Math.abs(best - y)) best = c;
  }
  return best;
}

// ホイールで近づく・離れる
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    camera.zoom = Math.max(0.4, Math.min(3, camera.zoom * Math.exp(-event.deltaY * 0.001)));
  },
  { passive: false }
);

window.addEventListener("resize", fitCanvas);

// キー操作（作品の画面を邪魔しないよう、ボタンは置かない）
window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === " ") {
    paused = !paused;
    event.preventDefault();
  } else if (key === "arrowleft" || key === "arrowright") {
    // ← → で、選んでいる年をまとめて1年前・1年後へずらす
    const shift = key === "arrowleft" ? -1 : 1;
    const next = chosen.map((y) => years[years.indexOf(y) + shift]);
    if (next.every((y) => y)) chooseYears(next);
  } else if (key === "s") {
    const link = document.createElement("a");
    const names = layers.map((l) => CITIES[l.city].id).join("_");
    link.download = `weather-fireflies-${names}-${yearText(chosen).replace(/〜/g, "-").replace(/・/g, "_")}.png`;
    // 作品の上に軸を重ねた1枚にして保存する
    const sheet = document.createElement("canvas");
    sheet.width = canvas.width;
    sheet.height = canvas.height;
    const sctx = sheet.getContext("2d");
    sctx.drawImage(canvas, 0, 0);
    sctx.drawImage(axesCanvas, 0, 0);
    link.href = sheet.toDataURL("image/png");
    link.click();
  }
});

// URLが #tokyo,paris/2010 のようなら、その都市（複数可）と年で始める
function readHash() {
  const match = location.hash.match(/^#([a-z,]+)(?:\/([\d,-]+))?/);
  if (!match) return false;
  // 年：2000-2004,2010 のような書き方を、年の一覧にする
  if (match[2]) {
    chosen = [];
    for (const part of match[2].split(",")) {
      const [a, b] = part.split("-").map(Number);
      for (let y = a; y <= (b || a); y++) chosen.push(String(y));
    }
  }
  for (const id of match[1].split(",")) {
    const city = CITIES.findIndex((c) => c.id === id);
    if (city >= 0 && !layers.some((l) => l.city === city)) layers.push({ city: city });
  }
  layers.sort((a, b) => a.city - b.city); // 上の欄と同じ並び順にする
  return layers.length > 0;
}

if (!readHash()) {
  layers = [{ city: 0 }];
}
fitCanvas();
start();
loop();

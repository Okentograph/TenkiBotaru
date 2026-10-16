// =============================================================
//  天気螢 ― データ取得
//  Open-Meteo の過去気象API から、都市ごとの日ごとの
//  気温・降水・日照を少しずつ取得し、weather-data.js として保存する。
//
//  Open-Meteo の無料枠では、2週間分のデータを1回と数える
//  （例：5年分 ≒ 130回）。1分600回・1時間5,000回・1日10,000回の
//  上限を超えないよう、1分あたり約70回の速さに抑えて取得する。
//  https://open-meteo.com/en/pricing
// =============================================================

const FIRST_YEAR = 2000; // 取得する期間（2000〜2024年の25年分）
const LAST_YEAR = 2024;
const CHUNK_YEARS = 5; // 1度に取る年数
const CALLS_PER_MINUTE = 70; // 取得の速さ（1時間に約4,200回）
const WAIT_AFTER_LIMIT = 10; // 回数制限（429）で断られたときに待つ分数

const runBtn = document.getElementById("runBtn");
const saveBtn = document.getElementById("saveBtn");
const statusLine = document.getElementById("status");
const cityTable = document.getElementById("cityTable");

let running = false;

function wait(minutes) {
  return new Promise((resolve) => setTimeout(resolve, minutes * 60 * 1000));
}

// 取得した分は、ページを閉じても消えないようブラウザに保存しておく
function storageKey(city) {
  return `weatherOrbit:${FIRST_YEAR}-${LAST_YEAR}:${city.id}`;
}

function loadProgress(city) {
  try {
    const saved = localStorage.getItem(storageKey(city));
    if (saved) return JSON.parse(saved);
  } catch (error) {
    // 保存が使えない環境では、毎回はじめから取る
  }
  return { start: `${FIRST_YEAR}-01-01`, next: FIRST_YEAR, done: false, temp: [], rain: [], sun: [] };
}

function saveProgress(city, data) {
  try {
    localStorage.setItem(storageKey(city), JSON.stringify(data));
  } catch (error) {
    statusLine.textContent = "ブラウザに途中経過を保存できませんでした（取得は続けます）";
  }
}

function round(value, digits) {
  return value === null ? null : Number(value.toFixed(digits));
}

// 1都市・ある年から CHUNK_YEARS 年分を取る
async function fetchChunk(city, fromYear) {
  const toYear = Math.min(fromYear + CHUNK_YEARS - 1, LAST_YEAR);
  const toDate = `${toYear}-12-31`;
  const url =
    "https://archive-api.open-meteo.com/v1/archive" +
    `?latitude=${city.lat}&longitude=${city.lon}` +
    `&start_date=${fromYear}-01-01&end_date=${toDate}` +
    "&daily=temperature_2m_mean,precipitation_sum,sunshine_duration" +
    "&timezone=auto";
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const d = (await response.json()).daily;
  return {
    days: d.time.length,
    temp: d.temperature_2m_mean.map((v) => round(v, 1)),
    rain: d.precipitation_sum.map((v) => round(v, 1)),
    sun: d.sunshine_duration.map((v) => (v === null ? null : round(v / 3600, 2))), // 秒 → 時間
    finished: toYear === LAST_YEAR,
  };
}

function renderTable() {
  cityTable.innerHTML = "";
  for (const city of CITIES) {
    const data = loadProgress(city);
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = city.name;
    const state = document.createElement("td");
    if (data.done) {
      state.textContent = `完了（${FIRST_YEAR}〜${LAST_YEAR}年 ${data.temp.length}日分）`;
      state.className = "done";
    } else if (data.temp.length > 0) {
      state.textContent = `${FIRST_YEAR}〜${data.next - 1}年まで取得済み`;
    } else {
      state.textContent = "未取得";
    }
    row.append(name, state);
    cityTable.appendChild(row);
  }
}

async function run() {
  running = true;
  runBtn.disabled = true;
  for (const city of CITIES) {
    const data = loadProgress(city);
    while (!data.done) {
      statusLine.textContent = `${city.name}：${data.next}年から${CHUNK_YEARS}年分を取得しています…`;
      try {
        const chunk = await fetchChunk(city, data.next);
        data.temp.push(...chunk.temp);
        data.rain.push(...chunk.rain);
        data.sun.push(...chunk.sun);
        data.next += CHUNK_YEARS;
        data.done = chunk.finished;
        saveProgress(city, data);
        renderTable();
        // 取った量（2週間分で1回）に合わせて待ち、回数制限を超えないようにする
        const calls = chunk.days / 14;
        const minutes = calls / CALLS_PER_MINUTE;
        statusLine.textContent = `${city.name}：${data.next - 1}年まで取得。回数制限のため ${minutes.toFixed(1)} 分待っています…`;
        await wait(minutes);
      } catch (error) {
        // 条件分岐：回数制限なら長めに、そのほかの失敗なら1分待って同じ所から取り直す
        const minutes = error.status === 429 ? WAIT_AFTER_LIMIT : 1;
        statusLine.textContent = `${city.name}：取得できませんでした（${error.message}）。${minutes}分後に取り直します…`;
        await wait(minutes);
      }
    }
  }
  statusLine.textContent = "すべての都市の取得が終わりました。「weather-data.js を保存」を押してください。";
  running = false;
  runBtn.disabled = false;
}

// 取得できた都市のデータを weather-data.js として書き出す
function save() {
  const all = {};
  for (const city of CITIES) {
    const data = loadProgress(city);
    if (data.temp.length > 0) {
      all[city.id] = { start: data.start, temp: data.temp, rain: data.rain, sun: data.sun };
    }
  }
  const text =
    "// Open-Meteo（https://open-meteo.com/）の過去気象APIから取得した、日ごとの\n" +
    "// 平均気温（℃）・降水量（mm）・日照時間（時間）。fetch-data.html で作成\n" +
    `// 作成日：${new Date().toISOString().slice(0, 10)}\n` +
    `const WEATHER_DATA = ${JSON.stringify(all)};\n`;
  const link = document.createElement("a");
  link.download = "weather-data.js";
  link.href = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
  link.click();
}

runBtn.addEventListener("click", () => {
  if (!running) run();
});
saveBtn.addEventListener("click", save);
renderTable();

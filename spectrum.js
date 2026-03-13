// ===== スペクトラム表示モード =====

let audioCtx;
let analyser;
let source;
let stream;
let animationId;
let fftSize = 4096;
let isRunning = false;

// DOM要素
const canvas = document.getElementById('spectrum-canvas');
const ctx = canvas.getContext('2d');
const controlsOverlay = document.getElementById('controls-overlay');
const miniControls = document.getElementById('mini-controls');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const fftSelect = document.getElementById('fft-size-select');
const scaleSelect = document.getElementById('scale-select');
const colorSelect = document.getElementById('color-select');
const vizSelect = document.getElementById('viz-select');
const freqLabelsContainer = document.getElementById('freq-labels');
const dbScaleContainer = document.getElementById('db-scale');
const pitchRanks = document.getElementById('pitch-ranks');

// ランク表示要素
const rankNotes = [
    document.getElementById('rank-note-1'),
    document.getElementById('rank-note-2'),
    document.getElementById('rank-note-3')
];
const rankFreqs = [
    document.getElementById('rank-freq-1'),
    document.getElementById('rank-freq-2'),
    document.getElementById('rank-freq-3')
];
const rankVocals = [
    document.getElementById('rank-vocal-1'),
    document.getElementById('rank-vocal-2'),
    document.getElementById('rank-vocal-3')
];
const rankBars = [
    document.getElementById('rank-bar-1'),
    document.getElementById('rank-bar-2'),
    document.getElementById('rank-bar-3')
];

const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// 設定
let freqScale = 'log';
let colorTheme = 'neon';
let vizMode = 'bars';

// ウォーターフォール用バッファ
let waterfallData = [];
const waterfallMaxRows = 300;

// スムージング用の前フレームデータ
let smoothedData = null;

// === 高音域ログ関連 ===
const highLogPanel = document.getElementById('high-log-panel');
const highLogList = document.getElementById('high-log-list');
const highLogCount = document.getElementById('high-log-count');

// hihihiE (E7) = MIDIノート番号 100
const HIGH_NOTE_THRESHOLD = 100;
let isHighPitchActive = false;
let highPitchStartTime = 0;
let maxNoteInBurst = 0;
let maxFreqInBurst = 0;
let burstRank2 = null; // {noteNum, freq}
let burstRank3 = null;
let logItemCount = 0;

// === キャンバスリサイズ ===
function resizeCanvas() {
    canvas.width = window.innerWidth * window.devicePixelRatio;
    canvas.height = window.innerHeight * window.devicePixelRatio;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    generateFreqLabels();
    generateDbScale();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// === 音名関連ユーティリティ ===
function getJapaneseVocalRange(noteNum) {
    const scientificOctave = Math.floor(noteNum / 12) - 1;
    const japaneseOctaveIndex = Math.floor((noteNum - 9) / 12);
    const noteName = noteStrings[(noteNum % 12 + 12) % 12];
    const rangeMap = {
        "-1": "lowlowlowlow", "0": "lowlowlow", "1": "lowlow", "2": "low",
        "3": "mid1", "4": "mid2", "5": "hi", "6": "hihi",
        "7": "hihihi", "8": "hihihihi", "9": "hihihihihi"
    };
    let prefix = rangeMap[japaneseOctaveIndex] || (japaneseOctaveIndex < -1 ? "low..." : "hi...");
    return `${prefix}${noteName} / ${noteName}${scientificOctave}`;
}

function freqToNoteName(freq) {
    const noteNum = 12 * (Math.log(freq / 440) / Math.log(2)) + 69;
    const rounded = Math.round(noteNum);
    const noteName = noteStrings[(rounded % 12 + 12) % 12];
    const octave = Math.floor(rounded / 12) - 1;
    return `${noteName}${octave}`;
}

function freqToNoteNum(freq) {
    return 12 * (Math.log(freq / 440) / Math.log(2)) + 69;
}

// === 周波数ラベル生成 ===
function generateFreqLabels() {
    freqLabelsContainer.innerHTML = '';
    const w = window.innerWidth;
    const freqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

    freqs.forEach(f => {
        const x = freqToX(f, w);
        if (x < 10 || x > w - 10) return;
        const label = document.createElement('div');
        label.className = 'freq-label';
        label.style.left = x + 'px';
        if (f >= 1000) {
            label.textContent = (f / 1000) + 'k';
        } else {
            label.textContent = f + '';
        }
        freqLabelsContainer.appendChild(label);
    });
}

// === dBスケール生成 ===
function generateDbScale() {
    dbScaleContainer.innerHTML = '';
    const h = window.innerHeight - 30;
    const steps = [-10, -20, -30, -40, -50, -60, -70, -80];

    steps.forEach(db => {
        const y = h - ((db + 100) / 100) * h;
        if (y < 10 || y > h - 10) return;
        const label = document.createElement('div');
        label.className = 'db-label';
        label.style.bottom = (window.innerHeight - y) + 'px';
        label.textContent = db + 'dB';
        dbScaleContainer.appendChild(label);
    });
}

// === 周波数→X座標の変換 ===
function freqToX(freq, width) {
    const nyquist = audioCtx ? audioCtx.sampleRate / 2 : 22050;
    if (freqScale === 'log') {
        const minLog = Math.log10(20);
        const maxLog = Math.log10(nyquist);
        const logFreq = Math.log10(Math.max(freq, 20));
        return ((logFreq - minLog) / (maxLog - minLog)) * width;
    } else {
        return (freq / nyquist) * width;
    }
}

// === ビンインデックス→X座標 ===
function binToX(binIndex, binCount, width) {
    if (!audioCtx) return 0;
    const nyquist = audioCtx.sampleRate / 2;
    const freq = (binIndex / binCount) * nyquist;
    return freqToX(freq, width);
}

// === カラーテーマ ===
function getBarColor(value, index, total) {
    const normalized = value / 255;
    const huePos = index / total;

    switch (colorTheme) {
        case 'neon':
            return `hsla(${180 + huePos * 100}, 100%, ${40 + normalized * 30}%, ${0.5 + normalized * 0.5})`;
        case 'fire':
            return `hsla(${huePos * 60}, 100%, ${30 + normalized * 40}%, ${0.5 + normalized * 0.5})`;
        case 'ice':
            return `hsla(${190 + huePos * 40}, 80%, ${30 + normalized * 45}%, ${0.5 + normalized * 0.5})`;
        case 'rainbow':
            return `hsla(${huePos * 360}, 90%, ${35 + normalized * 35}%, ${0.5 + normalized * 0.5})`;
        case 'mono':
            const brightness = 20 + normalized * 70;
            return `rgba(${brightness}%, ${brightness}%, ${brightness}%, ${0.4 + normalized * 0.6})`;
        default:
            return `hsla(${180 + huePos * 100}, 100%, 50%, ${0.5 + normalized * 0.5})`;
    }
}

function getGlowColor() {
    switch (colorTheme) {
        case 'neon': return 'rgba(0, 242, 255, 0.3)';
        case 'fire': return 'rgba(255, 100, 0, 0.3)';
        case 'ice': return 'rgba(100, 180, 255, 0.3)';
        case 'rainbow': return 'rgba(255, 100, 255, 0.3)';
        case 'mono': return 'rgba(200, 200, 200, 0.2)';
        default: return 'rgba(0, 242, 255, 0.3)';
    }
}

// === 上位3ピーク検出 ===
function detectTopPeaks(freqData, binCount) {
    if (!audioCtx) return [];
    const nyquist = audioCtx.sampleRate / 2;
    const minBin = Math.floor(20 * binCount / nyquist);   // 20Hz
    const maxBin = Math.min(binCount - 1, Math.floor(20000 * binCount / nyquist)); // 20kHz

    // すべてのローカルピークを検出
    const peaks = [];
    for (let i = minBin + 1; i < maxBin - 1; i++) {
        if (freqData[i] > freqData[i - 1] && freqData[i] > freqData[i + 1] && freqData[i] > 80) {
            const freq = (i / binCount) * nyquist;
            peaks.push({ bin: i, value: freqData[i], freq: freq });
        }
    }

    // 強度順でソート
    peaks.sort((a, b) => b.value - a.value);

    // ハーモニクス（倍音）をマージ：近い周波数のピークを除外
    const filtered = [];
    for (const p of peaks) {
        let tooClose = false;
        for (const f of filtered) {
            // 半音の半分（約3%）以内のピークは同一音扱い
            if (Math.abs(p.freq - f.freq) / f.freq < 0.03) {
                tooClose = true;
                break;
            }
        }
        if (!tooClose) {
            filtered.push(p);
        }
        if (filtered.length >= 3) break;
    }

    return filtered;
}

// === ランキング表示更新 ===
function updatePitchRanks(freqData, binCount) {
    const peaks = detectTopPeaks(freqData, binCount);

    // 各ランクの情報を収集
    const rankInfos = [];

    for (let i = 0; i < 3; i++) {
        if (i < peaks.length) {
            const p = peaks[i];
            const noteNum = Math.round(freqToNoteNum(p.freq));
            const noteName = freqToNoteName(p.freq);
            const vocalRange = getJapaneseVocalRange(noteNum);
            const strength = ((p.value / 255) * 100).toFixed(0);

            rankNotes[i].textContent = noteName;
            rankFreqs[i].textContent = p.freq.toFixed(1) + ' Hz';
            rankVocals[i].textContent = vocalRange.split(' / ')[0];
            rankBars[i].style.width = strength + '%';

            rankInfos.push({ noteNum, freq: p.freq });
        } else {
            rankNotes[i].textContent = '--';
            rankFreqs[i].textContent = '-- Hz';
            rankVocals[i].textContent = '---';
            rankBars[i].style.width = '0%';
            rankInfos.push(null);
        }
    }

    // 高音域ログ追跡（①②③すべて渡す）
    trackHighPitch(rankInfos[0], rankInfos[1], rankInfos[2]);
}

// === 描画関数群 ===

function drawBars(freqData, binCount) {
    const w = canvas.width;
    const h = canvas.height;

    // 背景
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, w, h);

    // グリッド線（横線 dB目盛り）
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let db = -80; db <= 0; db += 10) {
        const y = h - ((db + 100) / 100) * h;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }

    // グリッド線（縦線 周波数目安）
    const gridFreqs = [100, 1000, 10000];
    gridFreqs.forEach(f => {
        const x = freqToX(f, w);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    });

    // スムージングデータの初期化
    if (!smoothedData || smoothedData.length !== binCount) {
        smoothedData = new Float32Array(binCount);
    }

    const smoothing = 0.7;

    for (let i = 0; i < binCount; i++) {
        smoothedData[i] = smoothedData[i] * smoothing + freqData[i] * (1 - smoothing);

        const x1 = binToX(i, binCount, w);
        const x2 = binToX(i + 1, binCount, w);
        const barW = Math.max(x2 - x1 - 0.5, 1);
        const barH = (smoothedData[i] / 255) * h;

        if (barH < 1) continue;

        const color = getBarColor(smoothedData[i], i, binCount);
        ctx.fillStyle = color;
        ctx.fillRect(x1, h - barH, barW, barH);
    }

    // トップのグロー
    ctx.shadowBlur = 0;
}

function drawMirror(freqData, binCount) {
    const w = canvas.width;
    const h = canvas.height;
    const halfH = h / 2;

    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, w, h);

    if (!smoothedData || smoothedData.length !== binCount) {
        smoothedData = new Float32Array(binCount);
    }

    for (let i = 0; i < binCount; i++) {
        smoothedData[i] = smoothedData[i] * 0.7 + freqData[i] * 0.3;

        const x1 = binToX(i, binCount, w);
        const x2 = binToX(i + 1, binCount, w);
        const barW = Math.max(x2 - x1 - 0.5, 1);
        const barH = (smoothedData[i] / 255) * halfH;

        if (barH < 1) continue;

        const color = getBarColor(smoothedData[i], i, binCount);
        ctx.fillStyle = color;
        // 上半分
        ctx.fillRect(x1, halfH - barH, barW, barH);
        // 下半分（ミラー、少し暗く）
        ctx.globalAlpha = 0.5;
        ctx.fillRect(x1, halfH, barW, barH);
        ctx.globalAlpha = 1.0;
    }

    // 中央線
    ctx.strokeStyle = getGlowColor();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, halfH);
    ctx.lineTo(w, halfH);
    ctx.stroke();
}

function drawCircular(freqData, binCount) {
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.2;
    const maxBarLen = Math.min(w, h) * 0.3;

    ctx.fillStyle = 'rgba(5, 5, 8, 0.15)';
    ctx.fillRect(0, 0, w, h);

    if (!smoothedData || smoothedData.length !== binCount) {
        smoothedData = new Float32Array(binCount);
    }

    // 使用するビン数を減らす（見栄え）
    const useBins = Math.min(binCount, 360);
    const step = Math.floor(binCount / useBins);

    for (let i = 0; i < useBins; i++) {
        const idx = i * step;
        if (idx >= binCount) break;

        smoothedData[idx] = smoothedData[idx] * 0.75 + freqData[idx] * 0.25;

        const angle = (i / useBins) * Math.PI * 2 - Math.PI / 2;
        const barLen = (smoothedData[idx] / 255) * maxBarLen;

        if (barLen < 1) continue;

        const x1 = cx + Math.cos(angle) * radius;
        const y1 = cy + Math.sin(angle) * radius;
        const x2 = cx + Math.cos(angle) * (radius + barLen);
        const y2 = cy + Math.sin(angle) * (radius + barLen);

        ctx.strokeStyle = getBarColor(smoothedData[idx], idx, binCount);
        ctx.lineWidth = Math.max(2, (Math.PI * 2 * radius / useBins) * 0.6);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }
}

function drawWaterfall(freqData, binCount) {
    const w = canvas.width;
    const h = canvas.height;

    // 新しい行をバッファに追加
    const row = new Uint8Array(binCount);
    for (let i = 0; i < binCount; i++) {
        row[i] = freqData[i];
    }
    waterfallData.push(row);
    if (waterfallData.length > waterfallMaxRows) {
        waterfallData.shift();
    }

    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, w, h);

    const rowHeight = h / waterfallMaxRows;

    for (let r = 0; r < waterfallData.length; r++) {
        const data = waterfallData[r];
        const y = h - (waterfallData.length - r) * rowHeight;

        for (let i = 0; i < binCount; i++) {
            const x1 = binToX(i, binCount, w);
            const x2 = binToX(i + 1, binCount, w);
            const barW = Math.max(x2 - x1, 1);
            const val = data[i];

            if (val < 10) continue;

            ctx.fillStyle = getBarColor(val, i, binCount);
            ctx.fillRect(x1, y, barW, Math.ceil(rowHeight) + 1);
        }
    }
}

// === メインの描画ループ ===
function draw() {
    if (!isRunning) return;

    const binCount = analyser.frequencyBinCount;
    const freqData = new Uint8Array(binCount);
    analyser.getByteFrequencyData(freqData);

    // 描画モード選択
    switch (vizMode) {
        case 'bars': drawBars(freqData, binCount); break;
        case 'mirror': drawMirror(freqData, binCount); break;
        case 'circular': drawCircular(freqData, binCount); break;
        case 'waterfall': drawWaterfall(freqData, binCount); break;
        default: drawBars(freqData, binCount);
    }

    // ピッチランキング更新
    updatePitchRanks(freqData, binCount);

    animationId = requestAnimationFrame(draw);
}

// === 起動 ===
startBtn.addEventListener('click', async () => {
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = fftSize;
        analyser.smoothingTimeConstant = 0.6;

        source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        isRunning = true;

        controlsOverlay.classList.add('hidden');
        miniControls.classList.add('visible');
        pitchRanks.classList.add('visible');
        highLogPanel.classList.add('visible');

        generateFreqLabels();
        generateDbScale();

        draw();
    } catch (err) {
        console.error('マイクへのアクセスに失敗:', err);
        alert('マイクへのアクセスが拒否されました。設定を確認してください。');
    }
});

// === 停止 ===
stopBtn.addEventListener('click', () => {
    // 停止前にログをファイナライズ
    finalizeHighPitchLog();

    isRunning = false;
    if (animationId) cancelAnimationFrame(animationId);
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (audioCtx) audioCtx.close();

    controlsOverlay.classList.remove('hidden');
    miniControls.classList.remove('visible');
    pitchRanks.classList.remove('visible');
    highLogPanel.classList.remove('visible');

    smoothedData = null;
    waterfallData = [];

    // キャンバスクリア
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ランクリセット
    for (let i = 0; i < 3; i++) {
        rankNotes[i].textContent = '--';
        rankFreqs[i].textContent = '-- Hz';
        rankVocals[i].textContent = '---';
        rankBars[i].style.width = '0%';
    }
});

// === FFTサイズ変更 ===
fftSelect.addEventListener('change', (e) => {
    fftSize = parseInt(e.target.value);
    if (analyser && isRunning) {
        analyser.fftSize = fftSize;
        smoothedData = null;
    }
});

// === スケール変更 ===
scaleSelect.addEventListener('change', (e) => {
    freqScale = e.target.value;
    generateFreqLabels();
});

// === カラー変更 ===
colorSelect.addEventListener('change', (e) => {
    colorTheme = e.target.value;
});

// === 表示モード変更 ===
vizSelect.addEventListener('change', (e) => {
    vizMode = e.target.value;
    waterfallData = [];
    smoothedData = null;
});

// === 高音域ログ機能 ===

function trackHighPitch(r1, r2, r3) {
    const noteNum = r1 ? r1.noteNum : -1;
    const freq = r1 ? r1.freq : 0;

    if (noteNum >= HIGH_NOTE_THRESHOLD) {
        if (!isHighPitchActive) {
            // 高音域の検出開始
            isHighPitchActive = true;
            highPitchStartTime = performance.now();
            maxNoteInBurst = noteNum;
            maxFreqInBurst = freq;
            burstRank2 = r2 || null;
            burstRank3 = r3 || null;
        } else {
            // より高い音が出たら①②③すべて更新
            if (noteNum > maxNoteInBurst) {
                maxNoteInBurst = noteNum;
                maxFreqInBurst = freq;
                burstRank2 = r2 || null;
                burstRank3 = r3 || null;
            }
        }
    } else {
        // 高音域を抜けた→ログ確定
        finalizeHighPitchLog();
    }
}

function finalizeHighPitchLog() {
    if (!isHighPitchActive) return;

    const duration = (performance.now() - highPitchStartTime) / 1000;

    // 0.05秒以下はノイズとして無視
    if (duration > 0.05) {
        addHighLogItem(maxNoteInBurst, maxFreqInBurst, duration, burstRank2, burstRank3);
    }

    isHighPitchActive = false;
    burstRank2 = null;
    burstRank3 = null;
}

function formatRankSub(rankData) {
    if (!rankData) return '--';
    const vr = getJapaneseVocalRange(rankData.noteNum);
    return `${vr.split(' / ')[0]} (${rankData.freq.toFixed(0)}Hz)`;
}

function addHighLogItem(noteNum, freq, duration, r2, r3) {
    // プレースホルダー削除
    const empty = highLogList.querySelector('.high-log-empty');
    if (empty) empty.remove();

    logItemCount++;
    highLogCount.textContent = logItemCount;

    const vocalRange = getJapaneseVocalRange(noteNum);

    const item = document.createElement('div');
    item.className = 'high-log-item';
    item.innerHTML = `
        <div class="high-log-item-info">
            <span class="high-log-item-note">① ${vocalRange}</span>
            <span class="high-log-item-freq">${freq.toFixed(2)} Hz</span>
            <span class="high-log-item-sub">② ${formatRankSub(r2)}</span>
            <span class="high-log-item-sub">③ ${formatRankSub(r3)}</span>
        </div>
        <span class="high-log-item-duration">${duration.toFixed(2)}s</span>
    `;

    // 最新を上に追加
    highLogList.insertBefore(item, highLogList.firstChild);

    // 最大20件
    while (highLogList.children.length > 20) {
        highLogList.removeChild(highLogList.lastChild);
    }
}

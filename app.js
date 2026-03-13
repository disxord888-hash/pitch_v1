let audioCtx;
let analyser;
let source;
let stream;
let animationId;
const fftSize = 4096;
const bufferLength = fftSize;
const dataArray = new Float32Array(bufferLength);

const noteDisplay = document.getElementById('note-display');
const freqValue = document.getElementById('freq-value');
const vocalRange = document.getElementById('vocal-range');

const originalNoteDisplay = document.getElementById('original-note-display');
const originalFreqValue = document.getElementById('original-freq-value');
const originalVocalRange = document.getElementById('original-vocal-range');

const offsetSlider = document.getElementById('offset-slider');
const offsetValue = document.getElementById('offset-value');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusBadge = document.getElementById('status-badge');
const minNoteDisplay = document.getElementById('min-note-display');
const minRangeDisplay = document.getElementById('min-range-display');
const maxNoteDisplay = document.getElementById('max-note-display');
const maxRangeDisplay = document.getElementById('max-range-display');
const mainDisplay = document.querySelector('.main-display');

const currentDbZDisplay = document.getElementById('current-db-z');
const maxDbZDisplay = document.getElementById('max-db-z');
const currentDbADisplay = document.getElementById('current-db-a');
const maxDbADisplay = document.getElementById('max-db-a');

let sessionMaxDbZ = 0;
let sessionMaxDbA = 0;
const floatFreqData = new Float32Array(fftSize / 2);
let aWeightCurve = null;

const canvas = document.getElementById('visualizer');
const canvasCtx = canvas.getContext('2d');
const graphCanvas = document.getElementById('pitch-graph');
const graphCtx = graphCanvas.getContext('2d');

const pitchHistory = [];
const historyDuration = 2000; // 表示期間（ミリ秒）: 2秒

// 高音域（E7以上）の記録用
const highPitchLogContainer = document.getElementById('high-pitch-log');
let isHighPitchActive = false;
let highPitchStartTime = 0;
let maxNoteInCurrentBurst = 0;
let maxFreqInCurrentBurst = 0; // 追加

// セッション統計用
let sessionMinNoteNum = Infinity;
let sessionMaxNoteNum = -Infinity;
let sessionMinFreq = 0;
let sessionMaxFreq = 0;

// ランキング用データ (上位3件)
let sessionMinRanks = []; // {noteNum, freq, duration, noteInfo, noteName}
let sessionMaxRanks = [];
let sessionLongRanks = [];
// ランキング表示用要素
const sessionMinList = document.getElementById('session-min-list');
const sessionMaxList = document.getElementById('session-max-list');
const sessionLongList = document.getElementById('session-long-list');
const shareBtn = document.getElementById('share-btn');
const sessionStatusLabel = document.getElementById('session-status-label');
const sessionRangeWidthDisplay = document.getElementById('session-range-width');
const resetStatsBtn = document.getElementById('reset-stats-btn');

// 持続時間追跡用
let sessionMinStartTime = 0;
let sessionMaxStartTime = 0;
let sessionMinDuration = 0;
let sessionMaxDuration = 0;
let currentMinCandidate = -1;
let currentMaxCandidate = -1;
let currentMinCandidateFreq = 0;
let currentMaxCandidateFreq = 0;
let currentMinCandidateStartTime = 0;
let currentMaxCandidateStartTime = 0;
let lastDetectTime = 0;

// 最低持続時間の閾値（秒）
let minDurationThreshold = 0.2;
const durationSlider = document.getElementById('duration-slider');
const durationThresholdValue = document.getElementById('duration-threshold-value');

const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// オフセット（半音）
let pitchOffset = 0;

offsetSlider.addEventListener('input', (e) => {
    pitchOffset = parseInt(e.target.value);
    offsetValue.textContent = (pitchOffset >= 0 ? '+' : '') + pitchOffset;
});

durationSlider.addEventListener('input', (e) => {
    minDurationThreshold = parseFloat(e.target.value);
    durationThresholdValue.textContent = minDurationThreshold.toFixed(2);
});

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

        source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        startBtn.disabled = true;
        stopBtn.disabled = false;
        statusBadge.textContent = 'ACTIVE';
        statusBadge.classList.add('active');

        sessionStatusLabel.textContent = 'セッション記録 (録音中)';
        shareBtn.disabled = true;

        draw();
        detectPitch();
    } catch (err) {
        console.error('Error accessing microphone:', err);
        alert('マイクへのアクセスが拒否されました。設定を確認してください。');
    }
});

stopBtn.addEventListener('click', () => {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    if (audioCtx) {
        audioCtx.close();
    }
    cancelAnimationFrame(animationId);
    finalizeHighPitchLog();


    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusBadge.textContent = 'READY';
    statusBadge.classList.remove('active');

    if (sessionMaxNoteNum !== -Infinity) {
        sessionStatusLabel.textContent = 'セッション記録 (完了)';
        shareBtn.disabled = false;
    } else {
        sessionStatusLabel.textContent = 'セッション記録 (待機中)';
    }

    noteDisplay.textContent = '--';
    freqValue.textContent = '0.00';
    vocalRange.textContent = '---';
    originalNoteDisplay.textContent = '--';
    originalFreqValue.textContent = '0.00';
    originalVocalRange.textContent = '---';

    // 履歴をクリア
    pitchHistory.length = 0;
    minNoteDisplay.textContent = '--';
    minRangeDisplay.textContent = '---';
    maxNoteDisplay.textContent = '--';
    maxRangeDisplay.textContent = '---';
    currentDbZDisplay.textContent = '--';
    currentDbADisplay.textContent = '--';
});

resetStatsBtn.addEventListener('click', () => {
    if (!confirm('これまでのランキング記録をすべてクリアしますか？')) return;

    sessionMinNoteNum = Infinity;
    sessionMaxNoteNum = -Infinity;
    sessionMinRanks = [];
    sessionMaxRanks = [];
    sessionLongRanks = [];
    sessionMinDuration = 0;
    sessionMaxDbZ = 0;
    sessionMaxDbA = 0;
    maxDbZDisplay.textContent = '--';
    maxDbADisplay.textContent = '--';
    sessionMaxDuration = 0;
    currentMinCandidate = -1;
    currentMaxCandidate = -1;
    currentMinCandidateStartTime = 0;
    currentMaxCandidateStartTime = 0;

    updateRankDisplay('min');
    updateRankDisplay('max');
    updateRankDisplay('long');
    sessionRangeWidthDisplay.textContent = '0.00';
    sessionStatusLabel.textContent = 'セッション記録 (待機中)';
    shareBtn.disabled = true;
});

function detectPitch() {
    analyser.getFloatTimeDomainData(dataArray);
    analyser.getFloatFrequencyData(floatFreqData);

    if (!aWeightCurve) {
        aWeightCurve = new Float32Array(analyser.frequencyBinCount);
        const nyquist = audioCtx.sampleRate / 2;
        const binCount = analyser.frequencyBinCount;
        for (let i = 1; i < binCount; i++) {
            const f = i * nyquist / binCount;
            const f2 = f * f;
            const ra = (12194 * 12194 * f2 * f2) / ((f2 + 20.6 * 20.6) * Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) * (f2 + 12194 * 12194));
            const a_weight_db = 20 * Math.log10(ra) + 2.0;
            aWeightCurve[i] = Math.pow(10, a_weight_db / 10);
        }
    }

    let sumSq = 0;
    for (let i = 0; i < bufferLength; i++) {
        sumSq += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sumSq / bufferLength);

    let currentDbZ = 0;
    let currentDbA = 0;

    if (rms > 0.00001) {
        const dbZ_time = 20 * Math.log10(rms);
        const offset = 100; // Microphone calibration offset
        currentDbZ = dbZ_time + offset;

        const binCount = analyser.frequencyBinCount;
        let sumZ_freq = 0;
        let sumA_freq = 0;

        for (let i = 1; i < binCount; i++) {
            const db = floatFreqData[i];
            if (db === -Infinity) continue;
            const pZ = Math.pow(10, db / 10);
            sumZ_freq += pZ;
            sumA_freq += pZ * aWeightCurve[i];
        }

        if (sumZ_freq > 0 && sumA_freq > 0) {
            const dbZ_f = 10 * Math.log10(sumZ_freq);
            const dbA_f = 10 * Math.log10(sumA_freq);
            currentDbA = currentDbZ + (dbA_f - dbZ_f);
        } else {
            currentDbA = currentDbZ;
        }
    }

    currentDbZ = Math.max(0, currentDbZ);
    currentDbA = Math.max(0, currentDbA);

    if (currentDbZ > sessionMaxDbZ) sessionMaxDbZ = currentDbZ;
    if (currentDbA > sessionMaxDbA) sessionMaxDbA = currentDbA;

    currentDbZDisplay.textContent = currentDbZ.toFixed(1);
    currentDbADisplay.textContent = currentDbA.toFixed(1);
    maxDbZDisplay.textContent = sessionMaxDbZ.toFixed(1);
    maxDbADisplay.textContent = sessionMaxDbA.toFixed(1);

    let freq = autoCorrelate(dataArray, audioCtx.sampleRate);

    // 高周波（2000Hz以上など）や自己相関で取れなかった場合のFFT補完
    if (freq === -1 || freq > 2000) {
        const freqData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freqData);
        let maxVal = -1;
        let maxIdx = -1;
        for (let i = 0; i < freqData.length; i++) {
            if (freqData[i] > maxVal) {
                maxVal = freqData[i];
                maxIdx = i;
            }
        }
        if (maxVal > 100) { // 一定以上の強さがある場合
            const fftFreq = maxIdx * audioCtx.sampleRate / analyser.fftSize;
            // 自己相関の結果が著しく違う場合はFFT側を優先（超高域対応のため）
            if (freq === -1 || Math.abs(freq - fftFreq) > fftFreq * 0.2) {
                freq = fftFreq;
            }
        }
    }

    if (freq !== -1 && freq <= 22000) {
        // オフセット調整前の計算
        const originalFreq = freq;
        const originalNoteNum = 12 * (Math.log(originalFreq / 440) / Math.log(2)) + 69;

        if (!isNaN(originalNoteNum) && isFinite(originalNoteNum)) {
            const originalNoteIndex = Math.round(originalNoteNum) % 12;
            originalNoteDisplay.textContent = noteStrings[(originalNoteIndex + 12) % 12] || '--';
            originalFreqValue.textContent = originalFreq.toFixed(2);
            originalVocalRange.textContent = getJapaneseVocalRange(Math.round(originalNoteNum));
            updateSessionStats(originalNoteNum, originalFreq);
        }

        // オフセット調整後の計算
        const adjustedFreq = freq * Math.pow(2, pitchOffset / 12);
        freqValue.textContent = adjustedFreq.toFixed(2);
        const adjustedNoteNum = 12 * (Math.log(adjustedFreq / 440) / Math.log(2)) + 69;

        if (!isNaN(adjustedNoteNum) && isFinite(adjustedNoteNum)) {
            const adjustedNoteIndex = Math.round(adjustedNoteNum) % 12;
            noteDisplay.textContent = noteStrings[(adjustedNoteIndex + 12) % 12] || '--';
            vocalRange.textContent = getJapaneseVocalRange(Math.round(adjustedNoteNum));

            // 履歴に{時間, 値}を追加
            pitchHistory.push({ time: performance.now(), value: adjustedNoteNum });

            // hihihiA (93 / A6) 以上のログ記録ロジック (調整前の音程を使用)
            if (originalNoteNum >= 93) {
                if (!isHighPitchActive) {
                    isHighPitchActive = true;
                    highPitchStartTime = performance.now();
                    maxNoteInCurrentBurst = originalNoteNum;
                    maxFreqInCurrentBurst = originalFreq;
                } else {
                    if (originalNoteNum > maxNoteInCurrentBurst) {
                        maxNoteInCurrentBurst = originalNoteNum;
                        maxFreqInCurrentBurst = originalFreq;
                    }
                }
            } else {
                finalizeHighPitchLog();
            }
        } else {
            pitchHistory.push({ time: performance.now(), value: null });
            finalizeHighPitchLog();
            updateSessionStats(NaN, 0);
        }
    } else {
        pitchHistory.push({ time: performance.now(), value: null });
        finalizeHighPitchLog();
        updateSessionStats(NaN, 0);
    }

    // 2秒以上前のデータを削除
    const now = performance.now();
    while (pitchHistory.length > 0 && now - pitchHistory[0].time > historyDuration) {
        pitchHistory.shift();
    }

    // 最高音と最低音の計算
    updateMinMaxDisplay();

    animationId = requestAnimationFrame(detectPitch);
}

function updateSessionStats(noteNum, freq) {
    const now = performance.now();

    // 音が途切れた、または音が大きく変わった場合に、それまでの音を「確定」させる
    if (isNaN(noteNum) || !isFinite(noteNum)) {
        finalizeCandidate('min');
        finalizeCandidate('max');
        return;
    }

    // 最低音候補の更新
    if (currentMinCandidate === -1 || Math.abs(noteNum - currentMinCandidate) > 0.5) {
        finalizeCandidate('min');
        currentMinCandidate = noteNum;
        currentMinCandidateFreq = freq;
        currentMinCandidateStartTime = now;
    }

    // 最高音候補の更新
    if (currentMaxCandidate === -1 || Math.abs(noteNum - currentMaxCandidate) > 0.5) {
        finalizeCandidate('max');
        currentMaxCandidate = noteNum;
        currentMaxCandidateFreq = freq;
        currentMaxCandidateStartTime = now;
    }
}

function finalizeCandidate(type) {
    const candidate = type === 'min' ? currentMinCandidate : currentMaxCandidate;
    const startTime = type === 'min' ? currentMinCandidateStartTime : currentMaxCandidateStartTime;
    const freq = type === 'min' ? currentMinCandidateFreq : currentMaxCandidateFreq;

    if (candidate !== -1) {
        const duration = (performance.now() - startTime) / 1000;
        if (duration >= minDurationThreshold) {
            const entry = {
                noteNum: candidate,
                freq: freq,
                duration: duration,
                noteInfo: getJapaneseVocalRange(Math.round(candidate)),
                noteName: noteStrings[(Math.round(candidate) % 12 + 12) % 12]
            };
            updateRanks(type === 'min' ? sessionMinRanks : sessionMaxRanks, entry, type);
            // minとmaxは同じ音の記録なので、重複を避けるためにmaxの時だけlongも更新
            if (type === 'max') {
                updateRanks(sessionLongRanks, entry, 'long');
            }
        }
    }

    if (type === 'min') {
        currentMinCandidate = -1;
    } else {
        currentMaxCandidate = -1;
    }
}

function updateRanks(ranks, newEntry, type) {
    // 同じ音階（半音単位）が既にリストにあるか確認
    const existingIndex = ranks.findIndex(r => Math.abs(r.noteNum - newEntry.noteNum) < 0.5);

    if (existingIndex !== -1) {
        // 既にある場合は、持続時間が長い方を採用（または最新に更新）
        if (newEntry.duration > ranks[existingIndex].duration) {
            ranks[existingIndex] = newEntry;
        }
    } else {
        // 新規追加
        ranks.push(newEntry);
    }

    // ソート (minは昇順、maxは降順、longは持続時間の降順)
    if (type === 'min') {
        ranks.sort((a, b) => a.noteNum - b.noteNum);
    } else if (type === 'max') {
        ranks.sort((a, b) => b.noteNum - a.noteNum);
    } else if (type === 'long') {
        ranks.sort((a, b) => b.duration - a.duration);
    }

    // 上位3件に絞る
    if (ranks.length > 3) {
        ranks.length = 3;
    }

    // 1位が変わった場合のグローバル変数更新
    if (ranks.length > 0) {
        if (type === 'min') {
            sessionMinNoteNum = ranks[0].noteNum;
            sessionMinFreq = ranks[0].freq;
            sessionMinStartTime = ranks[0].duration > 0 ? (performance.now() - ranks[0].duration * 1000) : performance.now();
        } else if (type === 'max') {
            sessionMaxNoteNum = ranks[0].noteNum;
            sessionMaxFreq = ranks[0].freq;
            sessionMaxStartTime = ranks[0].duration > 0 ? (performance.now() - ranks[0].duration * 1000) : performance.now();
        }
    }

    updateRankDisplay(type);

    // 音域幅の更新 (1位同士で計算)
    if (sessionMinRanks.length > 0 && sessionMaxRanks.length > 0) {
        const octaveDiff = ((sessionMaxRanks[0].noteNum - sessionMinRanks[0].noteNum) / 12).toFixed(2);
        sessionRangeWidthDisplay.textContent = octaveDiff;
    }
}

function updateRankDisplay(type) {
    const list = type === 'min' ? sessionMinList : (type === 'max' ? sessionMaxList : sessionLongList);
    const ranks = type === 'min' ? sessionMinRanks : (type === 'max' ? sessionMaxRanks : sessionLongRanks);
    const badges = ["①", "②", "③"];

    list.innerHTML = '';

    if (ranks.length === 0) {
        list.innerHTML = '<div class="rank-empty">--</div>';
        return;
    }

    ranks.forEach((rank, i) => {
        const item = document.createElement('div');
        item.className = `rank-item rank-${i + 1}`;
        item.innerHTML = `
            <div class="rank-badge">${badges[i]}</div>
            <div class="rank-content">
                <div class="rank-main">
                    <span class="rank-note">${rank.noteName}</span>
                    <span class="rank-range">${rank.noteInfo.split(' / ')[0]}</span>
                </div>
                <div class="rank-sub">
                    ${rank.freq.toFixed(1)}Hz / ${rank.duration.toFixed(2)}s
                </div>
            </div>
        `;
        list.appendChild(item);
    });
}

shareBtn.addEventListener('click', async () => {
    // オクターブ差の計算 (1位同士)
    const octaveDiff = (sessionMinRanks.length > 0 && sessionMaxRanks.length > 0)
        ? ((sessionMaxRanks[0].noteNum - sessionMinRanks[0].noteNum) / 12).toFixed(2)
        : "0.00";

    let shareText = `【PICH - 録音結果分析】\n\n`;

    if (sessionMaxRanks.length > 0) {
        shareText += `🔥 最高音ランキング\n`;
        sessionMaxRanks.forEach((r, i) => {
            shareText += `${["①", "②", "③"][i]} ${r.noteInfo.split(' / ')[0]} (${r.freq.toFixed(1)}Hz / ${r.duration.toFixed(1)}s)\n`;
        });
        shareText += `\n`;
    }

    if (sessionMinRanks.length > 0) {
        shareText += `🎵 最低音ランキング\n`;
        sessionMinRanks.forEach((r, i) => {
            shareText += `${["①", "②", "③"][i]} ${r.noteInfo.split(' / ')[0]} (${r.freq.toFixed(1)}Hz / ${r.duration.toFixed(1)}s)\n`;
        });
        shareText += `\n`;
    }

    if (sessionLongRanks.length > 0) {
        shareText += `⏱️ 最長音ランキング\n`;
        sessionLongRanks.forEach((r, i) => {
            shareText += `${["①", "②", "③"][i]} ${r.noteInfo.split(' / ')[0]} (${r.freq.toFixed(1)}Hz / ${r.duration.toFixed(1)}s)\n`;
        });
        shareText += `\n`;
    }

    if (sessionMaxDbZ > 0 || sessionMaxDbA > 0) {
        shareText += `🔊 最高音圧: ${sessionMaxDbZ.toFixed(1)} dB-Z / ${sessionMaxDbA.toFixed(1)} dB-A\n\n`;
    }

    shareText += `🎹 音域幅: ${octaveDiff} オクターブ`;

    if (navigator.share) {
        try {
            await navigator.share({
                title: 'PICH 録音結果',
                text: shareText,
                url: window.location.href
            });
        } catch (err) {
            console.log('Share failed:', err);
        }
    } else {
        try {
            await navigator.clipboard.writeText(shareText);
            const originalText = shareBtn.innerHTML;
            shareBtn.innerHTML = 'コピーしました！';
            setTimeout(() => {
                shareBtn.innerHTML = originalText;
            }, 2000);
        } catch (err) {
            alert('共有機能がサポートされていないか、コピーに失敗しました。');
        }
    }
});

function finalizeHighPitchLog() {
    if (isHighPitchActive) {
        const duration = (performance.now() - highPitchStartTime) / 1000; // 秒に変換

        // 0.05秒以下の短い音はノイズとして除外
        if (duration > 0.05) {
            addLogItem(maxNoteInCurrentBurst, maxFreqInCurrentBurst, duration);
        }

        isHighPitchActive = false;
    }
}

function addLogItem(noteNum, freq, duration) {
    // プレースホルダーを削除（初回のみ）
    const placeholder = highPitchLogContainer.querySelector('.log-placeholder');
    if (placeholder) {
        placeholder.remove();
    }

    const item = document.createElement('div');
    item.className = 'log-item';

    const noteInfo = getJapaneseVocalRange(Math.round(noteNum));

    item.innerHTML = `
        <div class="log-main">
            <span class="log-note">${noteInfo}</span>
            <span class="log-freq">${freq.toFixed(2)} Hz</span>
        </div>
        <span class="log-duration">${duration.toFixed(2)}s</span>
    `;

    // 新しいログを上に追加
    highPitchLogContainer.insertBefore(item, highPitchLogContainer.firstChild);

    // ログが多くなりすぎたら古いものを削除（最大20件）
    if (highPitchLogContainer.children.length > 20) {
        highPitchLogContainer.removeChild(highPitchLogContainer.lastChild);
    }
}


function updateMinMaxDisplay() {
    const validNotes = pitchHistory.filter(h => h.value !== null).map(h => h.value);

    if (validNotes.length === 0) {
        return;
    }

    const minNoteNum = Math.min(...validNotes);
    const maxNoteNum = Math.max(...validNotes);

    const minNoteIndex = Math.round(minNoteNum) % 12;
    minNoteDisplay.textContent = noteStrings[(minNoteIndex + 12) % 12] || '--';
    minRangeDisplay.textContent = getJapaneseVocalRange(Math.round(minNoteNum));

    const maxNoteIndex = Math.round(maxNoteNum) % 12;
    maxNoteDisplay.textContent = noteStrings[(maxNoteIndex + 12) % 12] || '--';
    maxRangeDisplay.textContent = getJapaneseVocalRange(Math.round(maxNoteNum));
}

// 自己相関関数（Autocorrelation）の最適化版
function autoCorrelate(buf, sampleRate) {
    let SIZE = buf.length;
    let rms = 0;

    for (let i = 0; i < SIZE; i++) {
        const val = buf[i];
        rms += val * val;
    }
    rms = Math.sqrt(rms / SIZE);

    if (rms < 0.005) return -1; // ノイズ閾値を下げてより繊細に

    let r1 = 0, r2 = SIZE - 1;
    let thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++) {
        if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    }
    for (let i = 1; i < SIZE / 2; i++) {
        if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
    }

    buf = buf.slice(r1, r2);
    SIZE = buf.length;

    // 自己相関の計算（ラグを制限して高速化）
    // 20Hzまで対応する場合、44.1kHzでラグは約2205までで良い
    const maxLag = Math.min(SIZE, Math.floor(sampleRate / 20));
    const c = new Float32Array(maxLag).fill(0);
    for (let i = 0; i < maxLag; i++) {
        for (let j = 0; j < SIZE - i; j++) {
            c[i] = c[i] + buf[j] * buf[j + i];
        }
    }

    let d = 0;
    while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < maxLag; i++) {
        if (c[i] > maxval) {
            maxval = c[i];
            maxpos = i;
        }
    }

    if (maxpos === -1) return -1;

    let T0 = maxpos;

    // 放物線補間
    if (T0 > 0 && T0 < maxLag - 1) {
        const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
        const a = (x1 + x3 - 2 * x2) / 2;
        const b = (x3 - x1) / 2;
        if (a) T0 = T0 - b / (2 * a);
    }

    return sampleRate / T0;
}

function getJapaneseVocalRange(noteNum) {
    // 科学的ピッチ表記のオクターブ（Cが区切り）
    const scientificOctave = Math.floor(noteNum / 12) - 1;
    // 日本式表記のオクターブ（Aが区切り：A4がhiA、A3がmid2A...）
    // AはCから9半音上なので、9引いて12で割る
    const japaneseOctaveIndex = Math.floor((noteNum - 9) / 12);
    const noteName = noteStrings[(noteNum % 12 + 12) % 12];

    const rangeMap = {
        "-1": "lowlowlowlow",
        "0": "lowlowlow",
        "1": "lowlow",
        "2": "low",
        "3": "mid1",
        "4": "mid2",
        "5": "hi",
        "6": "hihi",
        "7": "hihihi",
        "8": "hihihihi",
        "9": "hihihihihi"
    };

    let prefix = rangeMap[japaneseOctaveIndex] || (japaneseOctaveIndex < -1 ? "low..." : "hi...");

    return `${prefix}${noteName} / ${noteName}${scientificOctave}`;
}

function draw() {
    const drawVisual = requestAnimationFrame(draw);

    // 波形データ
    analyser.getFloatTimeDomainData(dataArray);

    // 周波数データ（スペクトラム）
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqData);

    canvasCtx.fillStyle = '#0a0a0c';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    // スペクトラム（背景として薄く表示）
    const barWidth = (canvas.width / analyser.frequencyBinCount) * 2.5;
    let barHeight;
    let x_freq = 0;

    for (let i = 0; i < analyser.frequencyBinCount; i++) {
        barHeight = (freqData[i] / 255) * canvas.height;
        canvasCtx.fillStyle = `hsla(${260 + freqData[i] / 3}, 100%, 50%, 0.2)`;
        canvasCtx.fillRect(x_freq, canvas.height - barHeight, barWidth, barHeight);
        x_freq += barWidth + 1;
    }

    // 波形描画
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = '#00f2ff';
    canvasCtx.shadowBlur = 10;
    canvasCtx.shadowColor = '#00f2ff';
    canvasCtx.beginPath();

    const sliceWidth = canvas.width * 1.0 / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] * 0.8; // 少し抑えめに
        const y = canvas.height / 2 + v * canvas.height / 2;

        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }

        x += sliceWidth;
    }

    canvasCtx.lineTo(canvas.width, canvas.height / 2);
    canvasCtx.stroke();
    canvasCtx.shadowBlur = 0;

    // ピッチ履歴グラフの描画
    drawPitchGraph();
}

function drawPitchGraph() {
    graphCtx.fillStyle = 'rgba(10, 10, 12, 0.8)';
    graphCtx.fillRect(0, 0, graphCanvas.width, graphCanvas.height);

    if (pitchHistory.length < 2) return;

    // グリッド線と目盛り（C0〜C8）
    graphCtx.font = '12px "Outfit", sans-serif';
    graphCtx.textAlign = 'left';
    graphCtx.textBaseline = 'middle';

    for (let i = 12; i <= 108; i += 12) { // オクターブごと
        const y = graphCanvas.height - ((i - 12) / 96) * graphCanvas.height;

        // 目盛り線
        graphCtx.strokeStyle = (i === 60) ? 'rgba(0, 242, 255, 0.2)' : 'rgba(255, 255, 255, 0.08)'; // C4（中央ハ）は少し目立たせる
        graphCtx.lineWidth = (i === 60) ? 2 : 1;
        graphCtx.beginPath();
        graphCtx.moveTo(0, y);
        graphCtx.lineTo(graphCanvas.width, y);
        graphCtx.stroke();

        // 目盛りラベル
        const scientificOctave = Math.floor(i / 12) - 1;
        const japLabel = getJapaneseLabelForC(scientificOctave);

        graphCtx.fillStyle = (i === 60) ? 'rgba(0, 242, 255, 0.5)' : 'rgba(255, 255, 255, 0.3)';
        graphCtx.fillText(`C${scientificOctave} (${japLabel})`, 10, y - 2);
    }

    graphCtx.strokeStyle = '#7000ff';
    graphCtx.lineWidth = 3;
    graphCtx.lineJoin = 'round';
    graphCtx.lineCap = 'round';
    graphCtx.shadowBlur = 15;
    graphCtx.shadowColor = '#7000ff';
    graphCtx.beginPath();

    const now = performance.now();
    let firstPoint = true;

    for (let i = 0; i < pitchHistory.length; i++) {
        const item = pitchHistory[i];
        const val = item.value;
        const timeOffset = now - item.time;

        // 2秒前が左端(0)、現在が右端(width)
        const x = graphCanvas.width - (timeOffset / historyDuration) * graphCanvas.width;

        if (val === null) {
            if (!firstPoint) {
                graphCtx.stroke();
                graphCtx.beginPath();
                firstPoint = true;
            }
            continue;
        }

        // MIDIノート番号 12(C0)〜108(C8) を描画範囲とする
        const y = graphCanvas.height - ((val - 12) / 96) * graphCanvas.height;

        if (firstPoint) {
            graphCtx.moveTo(x, y);
            firstPoint = false;
        } else {
            graphCtx.lineTo(x, y);
        }
    }

    graphCtx.stroke();
    graphCtx.shadowBlur = 0;
}

// C音に対する日本式ラベルを返す補助関数
function getJapaneseLabelForC(octave) {
    const map = {
        "-1": "lowlowlowC",
        "0": "lowlowC",
        "1": "lowC",
        "2": "mid1C",
        "3": "mid2C",
        "4": "hiC",
        "5": "hihiC",
        "6": "hihihiC",
        "7": "hihihihiC",
        "8": "hihihihihiC"
    };
    return map[octave] || `C${octave}`;
}

// キャンバスサイズの初期化
function resizeCanvas() {
    canvas.width = canvas.clientWidth * window.devicePixelRatio;
    canvas.height = canvas.clientHeight * window.devicePixelRatio;
    graphCanvas.width = graphCanvas.clientWidth * window.devicePixelRatio;
    graphCanvas.height = graphCanvas.clientHeight * window.devicePixelRatio;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

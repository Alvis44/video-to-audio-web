import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

// --- DOM ---
const $ = (s) => document.querySelector(s);
const dropzone     = $('#dropzone');
const fileInput     = $('#file-input');
const fileInfo      = $('#file-info');
const fileName      = $('#file-name');
const fileSize      = $('#file-size');
const formatSection = $('#format-section');
const formatSelect  = $('#format-select');
const progressSection = $('#progress-section');
const progressFill  = $('#progress-fill');
const progressText  = $('#progress-text');
const btnConvert    = $('#btn-convert');
const btnDownload   = $('#btn-download');
const statusBar     = $('#status-bar');
const statusText    = $('#status-text');
const spinner       = $('#spinner');
const logPre        = $('#log');
const notifySound   = $('#notify-sound');
const notifyPush    = $('#notify-push');

// --- State ---
let ffmpeg = null;
let loaded = false;
let inputFile = null;    // File object
let outputURL = null;    // blob URL for download
let converting = false;  // защита от повторного запуска

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB — лимит WASM памяти
let durationKnown = false;  // определена ли длительность файла
let inputFileSize = 0;      // размер входного файла в байтах
let lastLogSize = 0;        // последний size= из лога ffmpeg (кБ)

// --- Format config ---
const FORMAT_MAP = {
  mp3:  { ext: 'mp3',  args: ['-vn', '-acodec', 'libmp3lame', '-q:a', '2'] },
  wav:  { ext: 'wav',  args: ['-vn', '-acodec', 'pcm_s16le'] },
  aac:  { ext: 'm4a',  args: ['-vn', '-acodec', 'aac', '-b:a', '192k'] },
  ogg:  { ext: 'ogg',  args: ['-vn', '-acodec', 'libvorbis', '-q:a', '5'] },
  flac: { ext: 'flac', args: ['-vn', '-acodec', 'flac'] },
};

// --- Helpers ---
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' КБ';
  return (bytes / 1048576).toFixed(1) + ' МБ';
}

function log(msg) {
  logPre.textContent += msg + '\n';
  logPre.scrollTop = logPre.scrollHeight;
}

function setStatus(text, type = '') {
  statusBar.classList.remove('hidden', 'ready', 'error');
  statusBar.className = 'status-bar' + (type ? ' ' + type : '');
  statusText.textContent = text;
}

function showSpinner(show) {
  spinner.classList.toggle('hidden', !show);
}

// --- Load FFmpeg ---
async function loadFFmpeg() {
  setStatus('Загрузка FFmpeg (~30 МБ, только первый раз)…');
  showSpinner(true);
  log('[init] Загрузка ffmpeg.wasm…');

  ffmpeg = new FFmpeg();

  ffmpeg.on('log', ({ message }) => {
    log('[ffmpeg] ' + message);
    // Парсим size= из лога для byte-based прогресса
    const sizeMatch = message.match(/size=\s*(\d+)kB/);
    if (sizeMatch) lastLogSize = parseInt(sizeMatch[1]) * 1024;
    // Определяем наличие Duration
    if (message.includes('Duration:') && !message.includes('N/A')) durationKnown = true;
    if (message.includes('Duration: N/A')) durationKnown = false;
  });

  ffmpeg.on('progress', ({ progress, time }) => {
    if (durationKnown && progress > 0 && progress <= 1) {
      // Нормальный режим: ffmpeg знает длительность
      const pct = Math.min(100, Math.round(progress * 100));
      progressFill.classList.remove('indeterminate');
      progressFill.style.width = pct + '%';
      progressText.textContent = pct + '%';
    } else {
      // Длительность неизвестна — анимация + обработанные байты
      progressFill.classList.add('indeterminate');
      progressFill.style.width = '100%';
      progressText.textContent = lastLogSize > 0
        ? formatBytes(lastLogSize) + ' обработано'
        : 'Обработка…';
    }
  });

  try {
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm';
    await ffmpeg.load({
      coreURL:   await toBlobURL(`${baseURL}/ffmpeg-core.js`,   'text/javascript'),
      wasmURL:   await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    loaded = true;
    setStatus('FFmpeg готов ✓', 'ready');
    showSpinner(false);
    log('[init] FFmpeg загружен и готов к работе');
    updateConvertBtn();
  } catch (err) {
    setStatus('Ошибка загрузки FFmpeg: ' + err.message, 'error');
    showSpinner(false);
    log('[error] ' + err.message);
  }
}

// --- File handling ---
function handleFile(file) {
  if (!file || !file.type.startsWith('video/')) {
    // Try by extension
    const ext = file?.name?.split('.').pop()?.toLowerCase();
    const videoExts = ['mp4','avi','mov','mkv','flv','wmv','webm','m4v','ts','3gp'];
    if (!ext || !videoExts.includes(ext)) {
      alert('Пожалуйста, выберите видео файл');
      return;
    }
  }
  // Reject files > 2 GB
  if (file.size > MAX_FILE_SIZE) {
    alert(`Файл слишком большой (${formatBytes(file.size)}).\nМаксимальный размер — 2 ГБ (ограничение WebAssembly).`);
    return;
  }
  inputFile = file;

  // Update UI
  fileName.textContent = file.name;
  fileSize.textContent = formatBytes(file.size);
  fileInfo.classList.remove('hidden');
  formatSection.classList.remove('hidden');
  dropzone.classList.add('has-file');

  // Reset previous output
  if (outputURL) { URL.revokeObjectURL(outputURL); outputURL = null; }
  btnDownload.classList.add('hidden');
  progressSection.classList.add('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = '0%';

  updateConvertBtn();
}

function updateConvertBtn() {
  btnConvert.disabled = !(loaded && inputFile);
}

// --- Convert ---
async function convert() {
  if (!loaded || !inputFile || converting) return;
  converting = true;

  const fmt = FORMAT_MAP[formatSelect.value];
  const inputName  = 'input' + getExtension(inputFile.name);
  const outputName = 'output.' + fmt.ext;

  btnConvert.disabled = true;
  btnDownload.classList.add('hidden');
  progressSection.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = '0%';
  setStatus('Конвертация…');
  showSpinner(true);
  log(`[convert] ${inputFile.name} → ${outputName}`);
  // Сброс состояния прогресса
  durationKnown = false;
  inputFileSize = inputFile.size;
  lastLogSize = 0;
  try {
    const startTime = performance.now();

    // Write file to FFmpeg FS (use arrayBuffer directly — fewer copies than fetchFile)
    setStatus('Загрузка файла в память…');
    let buf = await inputFile.arrayBuffer();
    await ffmpeg.writeFile(inputName, new Uint8Array(buf));
    buf = null; // освобождаем память

    // Run conversion
    setStatus('Конвертация…');
    await ffmpeg.exec(['-i', inputName, ...fmt.args, outputName]);

    // Read result
    const result = await ffmpeg.readFile(outputName);

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

    // Create download blob
    const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac' };
    const blob = new Blob([result.buffer], { type: mimeMap[fmt.ext] || 'audio/mpeg' });
    outputURL = URL.createObjectURL(blob);

    // Done
    progressFill.classList.remove('indeterminate');
    progressFill.style.width = '100%';
    progressText.textContent = '100%';
    setStatus(`Готово за ${elapsed}с  ·  ${formatBytes(blob.size)}`, 'ready');
    showSpinner(false);
    log(`[done] Конвертация завершена за ${elapsed}с, размер: ${formatBytes(blob.size)}`);

    btnDownload.classList.remove('hidden');
    btnConvert.disabled = false;

    // Уведомления
    notifyDone(inputFile.name, formatBytes(blob.size));

    // Cleanup FS
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

  } catch (err) {
    setStatus('Ошибка: ' + err.message, 'error');
    showSpinner(false);
    log('[error] ' + err.message);
    btnConvert.disabled = false;
  } finally {
    converting = false;
  }
}

function getExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.substring(dot) : '';
}

function downloadResult() {
  if (!outputURL) return;
  const fmt = FORMAT_MAP[formatSelect.value];
  const baseName = inputFile.name.replace(/\.[^.]+$/, '');
  const a = document.createElement('a');
  a.href = outputURL;
  a.download = baseName + '.' + fmt.ext;
  a.click();
}

// --- Notifications ---
function playDoneSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Два коротких тона: подняться в высоту
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.15);
      osc.stop(ctx.currentTime + i * 0.15 + 0.25);
    });
  } catch (e) { /* ignore */ }
}

const ICON_URL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='12' fill='%236c63ff'/%3E%3Cpath d='M11 6v7.55A3 3 0 1 0 13 16V9h3V6h-5z' fill='white'/%3E%3C/svg%3E";

function showBrowserNotification(title, body) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: ICON_URL });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(p => {
      if (p === 'granted') new Notification(title, { body, icon: ICON_URL });
    });
  }
}

function notifyDone(fileName, size) {
  if (notifySound.checked) playDoneSound();
  if (notifyPush.checked) showBrowserNotification('Конвертация завершена!', `${fileName} · ${size}`);
}

// --- Events ---

// Dropzone click
dropzone.addEventListener('click', () => fileInput.click());

// File input change
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

// Drag & drop
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});
dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('drag-over');
});
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

// Buttons
btnConvert.addEventListener('click', convert);
btnDownload.addEventListener('click', downloadResult);

// Push notification checkbox — request permission on check
notifyPush.addEventListener('change', () => {
  if (notifyPush.checked && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(p => {
      if (p === 'denied') { notifyPush.checked = false; }
    });
  }
});

// --- Init ---
loadFFmpeg();

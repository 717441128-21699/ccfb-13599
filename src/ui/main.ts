import { App, SAMPLE_LINES, VOICE_PROFILES } from './app';
import { ALL_VISEMES } from '../core/types';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

// 口型图例。
const legend = $('viseme-legend');
for (const v of ALL_VISEMES) {
  const chip = document.createElement('span');
  chip.className = 'viseme-chip';
  chip.textContent = v;
  legend.appendChild(chip);
}

const app = new App(
  $('three-canvas') as HTMLCanvasElement,
  $('timeline-canvas') as HTMLCanvasElement,
);

// 台词选择列表。
const lineSelect = $('line-select') as HTMLSelectElement;
for (const line of SAMPLE_LINES) {
  const opt = document.createElement('option');
  opt.value = line.text;
  opt.textContent = `${line.id}　${line.text}`;
  lineSelect.appendChild(opt);
}

const profileSelect = $('profile-select') as HTMLSelectElement;
for (const [id, p] of Object.entries(VOICE_PROFILES)) {
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = profileLabel(id, p.formantScale);
  profileSelect.appendChild(opt);
}
const noiseToggle = $('noise-toggle') as HTMLInputElement;

function profileLabel(id: string, scale: number): string {
  const names: Record<string, string> = {
    male: '男声（标准）', female: '女声', dialect: '方言变体', retake: '重录版（语速快）',
  };
  return names[id] ?? `${id} (${scale})`;
}

let currentText = SAMPLE_LINES[0].text;
function reload(): void {
  currentText = lineSelect.value || currentText;
  app.loadSample(currentText, profileSelect.value, noiseToggle.checked);
}

lineSelect.addEventListener('change', reload);
profileSelect.addEventListener('change', () => app.switchVoice(profileSelect.value, noiseToggle.checked));
noiseToggle.addEventListener('change', () => app.switchVoice(profileSelect.value, noiseToggle.checked));

$('btn-play').addEventListener('click', () => app.play());
$('btn-pause').addEventListener('click', () => app.pause());
$('btn-reload').addEventListener('click', reload);

// 自定义文本。
$('btn-apply-text').addEventListener('click', () => {
  const text = ($('custom-text') as HTMLTextAreaElement).value.trim();
  if (!text) return;
  currentText = text;
  app.loadSample(text, profileSelect.value, noiseToggle.checked);
});

// WAV 导入。
const fileInput = $('wav-file') as HTMLInputElement;
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const text = ($('custom-text') as HTMLTextAreaElement).value.trim() || currentText;
  await app.importWav(file, text);
});

// 导出。
$('btn-export').addEventListener('click', () => {
  const { json, wav } = app.exportClip();
  downloadBlob(new Blob([json], { type: 'application/json' }), 'lipsync-clip.json');
  const wavBytes = new Uint8Array(wav.byteLength);
  wavBytes.set(wav);
  downloadBlob(new Blob([wavBytes], { type: 'audio/wav' }), 'voice.wav');
});

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// 初始加载。
reload();

/**
 * 命令行工具：
 *   generate-samples   生成样本配音 WAV + 台词清单到数据目录
 *   batch <manifest>   按清单批量处理，输出每句口型 JSON 与精度/耗时报告
 *   benchmark [n]      生成 N 句基准，统计对齐精度与吞吐（句/小时）
 *   accuracy           对 24 条内置样本做完整精度评估（干净 + 噪声 + 多 profile）
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { aggregate, buildEvalCase, evaluateCase } from '../core/accuracy';
import { decodeWav, encodeWav } from '../core/audio';
import { parseLine } from '../core/pinyin';
import { runPipeline } from '../core/pipeline';
import { generateBenchLines, SAMPLE_LINES } from '../core/samples';
import { mixWithBed, synthesizeLine, VOICE_PROFILES } from '../core/synth';
import type { BatchJob, BatchResult } from '../core/types';

function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}

/** 生成样本：每句一个 WAV + 一份清单。 */
function generateSamples(outDir: string): void {
  ensureDir(outDir);
  const audioDir = join(outDir, 'audio');
  ensureDir(audioDir);
  const jobs: BatchJob[] = [];
  for (const line of SAMPLE_LINES) {
    const parsed = parseLine(line.text);
    const { audio } = synthesizeLine(parsed.syllables, { seed: 7 });
    const wavPath = join(audioDir, `${line.id}.wav`);
    writeFileSync(wavPath, encodeWav(audio));
    // 同时生成一个带噪版本，验证鲁棒性。
    const noisy = mixWithBed(audio, { bgmGain: 0.2, sfxCount: 3, seed: 7 });
    writeFileSync(join(audioDir, `${line.id}.noisy.wav`), encodeWav(noisy));
    jobs.push({ id: line.id, text: line.text, audio: `audio/${line.id}.wav` });
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(jobs, null, 2));
  console.log(`已生成 ${jobs.length} 条样本（含带噪版本）到 ${outDir}`);
}

/** 批量处理：读清单 → 管线 → 写 JSON，统计耗时与吞吐。 */
function batch(manifestPath: string, outDir: string): void {
  ensureDir(outDir);
  const jobs = JSON.parse(readFileSync(manifestPath, 'utf8')) as BatchJob[];
  const results: BatchResult[] = [];
  const manifestDir = dirname(manifestPath);
  const t0 = Date.now();
  for (const job of jobs) {
    const start = Date.now();
    try {
      const wavPath = join(manifestDir, job.audio.replace(/\//g, require_sep()));
      const audio = decodeWav(new Uint8Array(readFileSync(wavPath)));
      const { clip } = runPipeline(job.text, audio, {
        id: job.id, voiceProfile: job.voiceProfile ?? 'male',
        pinyinOverride: job.pinyinOverride,
      });
      writeFileSync(join(outDir, `${job.id}.json`), JSON.stringify(clip, null, 2));
      results.push({ job, ok: true, clip, elapsedMs: Date.now() - start });
    } catch (err) {
      results.push({
        job, ok: false, error: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - start,
      });
    }
  }
  const totalMs = Date.now() - t0;
  printBatchReport(results, totalMs);
}

function require_sep(): string {
  return process.platform === 'win32' ? '\\' : '/';
}

function printBatchReport(results: BatchResult[], totalMs: number): void {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const avgMs = ok.reduce((a, r) => a + r.elapsedMs, 0) / Math.max(1, ok.length);
  const perHour = Math.round((ok.length / Math.max(1, totalMs)) * 3_600_000);
  console.log('─'.repeat(56));
  console.log(`批量处理完成：成功 ${ok.length} / 失败 ${failed.length}`);
  console.log(`总耗时 ${totalMs}ms，单句平均 ${avgMs.toFixed(1)}ms`);
  console.log(`吞吐 ≈ ${perHour} 句/小时（目标 ≥ 500）`);
  if (failed.length) {
    console.log('失败项：');
    for (const r of failed) console.log(`  ${r.job.id}: ${r.error}`);
  }
  writeFileSync(
    join(process.cwd(), 'batch-report.json'),
    JSON.stringify({ total: results.length, ok: ok.length, perHour, results }, null, 2),
  );
}

/** 基准：N 句随机台词，统计精度 + 吞吐。 */
function benchmark(n: number): void {
  const lines = generateBenchLines(n);
  const results = [];
  const t0 = Date.now();
  for (const line of lines) {
    const parsed = parseLine(line.text);
    const { audio } = synthesizeLine(parsed.syllables, { seed: 7 });
    const start = Date.now();
    const { clip } = runPipeline(line.text, audio, { id: line.id });
    results.push({ id: line.id, elapsedMs: Date.now() - start, score: clip.meta.alignmentScore });
  }
  const totalMs = Date.now() - t0;
  const perHour = Math.round((lines.length / totalMs) * 3_600_000);
  const avgScore = results.reduce((a, r) => a + r.score, 0) / results.length;
  console.log('─'.repeat(56));
  console.log(`基准 ${n} 句：总耗时 ${totalMs}ms，吞吐 ≈ ${perHour} 句/小时`);
  console.log(`平均对齐分 ${avgScore.toFixed(3)}（越高越好）`);
}

/** 完整精度评估：24 句 × 干净/噪声 × 4 profile。 */
function accuracy(): void {
  const scenarios: { name: string; noisy: boolean; profileId: string }[] = [
    { name: '干净·男声', noisy: false, profileId: 'male' },
    { name: '噪声·男声', noisy: true, profileId: 'male' },
    { name: '干净·女声', noisy: false, profileId: 'female' },
    { name: '干净·方言', noisy: false, profileId: 'dialect' },
    { name: '噪声·方言', noisy: true, profileId: 'dialect' },
    { name: '干净·重录', noisy: false, profileId: 'retake' },
  ];
  for (const sc of scenarios) {
    const profile = VOICE_PROFILES[sc.profileId];
    const cases = SAMPLE_LINES.map((l) =>
      buildEvalCase(l.id, l.text, profile, sc.noisy, 7));
    const report = aggregate(cases.map(evaluateCase));
    console.log(
      `${sc.name.padEnd(10)} 均值=${String(report.meanErrorMs).padStart(7)}ms `
      + `P95=${String(report.p95ErrorMs).padStart(7)}ms 最大=${String(report.maxErrorMs).padStart(7)}ms `
      + `一帧内=${(report.withinOneFrameRatio * 100).toFixed(1)}%`,
    );
  }
}

const [, , cmd, arg1, arg2] = process.argv;
const dataDir = arg1 || 'data/samples';
switch (cmd) {
  case 'generate-samples':
    generateSamples(dataDir);
    break;
  case 'batch':
    if (!arg1) throw new Error('用法：batch <manifest.json> [outDir]');
    batch(arg1, arg2 || 'data/output');
    break;
  case 'benchmark':
    benchmark(Number(arg1) || 200);
    break;
  case 'accuracy':
    accuracy();
    break;
  default:
    console.log('命令：generate-samples | batch <manifest> [out] | benchmark [n] | accuracy');
}

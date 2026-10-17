import type { Page } from '@playwright/test';

export interface GLCounts {
  created: number;
  deleted: number;
  invalidated: number;
  live: number;
  peak: number;
}
export interface GLContextReport {
  id: number;
  lost: boolean;
  losses: number;
  draws: number;
  width: number;
  height: number;
  resources: Record<string, GLCounts>;
}
declare global {
  interface Window {
    __haenGLReport(): GLContextReport[];
  }
}

// This probe exists only inside isolated test pages; no production diagnostic API is added.
export async function installGLProbe(page: Page) {
  await page.addInitScript(() => {
    const reports: GLContextReport[] = [];
    const contexts = new WeakMap<WebGLRenderingContext | WebGL2RenderingContext, GLContextReport>();
    const handles = new WeakMap<
      object,
      { counts: GLCounts; deleted: boolean; report: GLContextReport; epoch: number }
    >();
    function context(gl: WebGLRenderingContext | WebGL2RenderingContext) {
      let report = contexts.get(gl);
      if (!report) {
        report = {
          id: reports.length + 1,
          lost: false,
          losses: 0,
          draws: 0,
          width: 0,
          height: 0,
          resources: {},
        };
        contexts.set(gl, report);
        reports.push(report);
        const current = report;
        gl.canvas.addEventListener('webglcontextlost', () => {
          current.lost = true;
          current.losses++;
          for (const counts of Object.values(current.resources)) {
            counts.invalidated += counts.live;
            counts.live = 0;
          }
        });
        gl.canvas.addEventListener('webglcontextrestored', () => {
          current.lost = false;
        });
      }
      return report;
    }
    for (const constructor of [
      globalThis.WebGLRenderingContext,
      globalThis.WebGL2RenderingContext,
    ]) {
      if (!constructor) continue;
      const prototype = constructor.prototype as unknown as Record<string, unknown>;
      const wrap = (
        name: string,
        after: (
          gl: WebGLRenderingContext | WebGL2RenderingContext,
          result: unknown,
          args: unknown[],
        ) => void,
      ) => {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        if (!descriptor || typeof descriptor.value !== 'function') return;
        const original = descriptor.value as (...args: unknown[]) => unknown;
        Object.defineProperty(prototype, name, {
          ...descriptor,
          value: function (
            this: WebGLRenderingContext | WebGL2RenderingContext,
            ...args: unknown[]
          ) {
            const result = original.apply(this, args);
            after(this, result, args);
            return result;
          },
        });
      };
      for (const kind of [
        'Buffer',
        'Framebuffer',
        'Program',
        'Renderbuffer',
        'Shader',
        'Texture',
        'VertexArray',
        'Sampler',
        'Query',
        'TransformFeedback',
      ]) {
        wrap('create' + kind, (gl, result) => {
          if (!result || typeof result !== 'object') return;
          const report = context(gl);
          const counts = (report.resources[kind] ??= {
            created: 0,
            deleted: 0,
            invalidated: 0,
            live: 0,
            peak: 0,
          });
          counts.created++;
          counts.live++;
          counts.peak = Math.max(counts.peak, counts.live);
          handles.set(result, { counts, deleted: false, report, epoch: report.losses });
        });
        wrap('delete' + kind, (_gl, _result, args) => {
          const value = args[0];
          if (!value || typeof value !== 'object') return;
          const handle = handles.get(value);
          if (!handle || handle.deleted || handle.epoch !== handle.report.losses) return;
          handle.deleted = true;
          handle.counts.deleted++;
          handle.counts.live--;
        });
      }
      for (const method of [
        'drawArrays',
        'drawElements',
        'drawArraysInstanced',
        'drawElementsInstanced',
      ])
        wrap(method, (gl) => {
          const report = context(gl);
          report.draws++;
          report.width = gl.drawingBufferWidth;
          report.height = gl.drawingBufferHeight;
        });
    }
    window.__haenGLReport = () => structuredClone(reports);
  });
}

export function glReport(page: Page) {
  return page.evaluate(() => window.__haenGLReport());
}

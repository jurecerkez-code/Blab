// onnxruntime-web ships types, but its package.json "exports" map keeps
// TypeScript from resolving them under "bundler" resolution. The surface Blab
// uses is tiny, so declare just that rather than vendor the whole .d.ts.
declare module 'onnxruntime-web' {
  export class Tensor {
    constructor(type: string, data: ArrayBufferView | number[], dims?: number[]);
    readonly data: Float32Array | BigInt64Array;
  }
  export interface InferenceSession {
    readonly inputNames: string[];
    readonly outputNames: string[];
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  }
  export const InferenceSession: {
    create(uri: string, options?: { executionProviders?: string[] }): Promise<InferenceSession>;
  };
  export const env: {
    wasm: {
      wasmPaths?: string;
      numThreads?: number;
    };
  };
}

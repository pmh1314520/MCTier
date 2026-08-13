/* LocalVQE streaming worker. The model and WASM engine stay off the UI thread. */
let modulePromise;
let moduleInstance;
let context;
let processFrame;
let streamInput = [];
let streamOutput = new Array(128).fill(0);

async function load() {
  if (modulePromise) return modulePromise;
  importScripts('/localvqe/localvqe.js');
  modulePromise = self.createLocalVQEModule({
    locateFile: (file) => `/localvqe/${file}`,
  }).then((instance) => {
    moduleInstance = instance;
    const wrap = (name, result, args) => instance.cwrap(name, result, args);
    const optionsNew = wrap('localvqe_options_new', 'number', []);
    const optionsSetModel = wrap('localvqe_options_set_model_path', 'number', ['number', 'string']);
    const optionsSetThreads = wrap('localvqe_options_set_threads', 'number', ['number', 'number']);
    const create = wrap('localvqe_new_with_options', 'number', ['number']);
    const optionsFree = wrap('localvqe_options_free', null, ['number']);
    processFrame = wrap('localvqe_process_frame_f32', 'number', ['number', 'number', 'number', 'number', 'number']);
    const setNoiseGate = wrap('localvqe_set_noise_gate', 'number', ['number', 'number']);
    const lastError = wrap('localvqe_last_error', 'string', ['number']);
    const modelPath = '/mctier-localvqe.gguf';
    return fetch('/localvqe/localvqe-pi-v1-49k-f32.gguf')
      .then((response) => {
        if (!response.ok) throw new Error(`LocalVQE model download failed (${response.status})`);
        return response.arrayBuffer();
      })
      .then((bytes) => {
        instance.FS.writeFile(modelPath, new Uint8Array(bytes));
        const options = optionsNew();
        optionsSetModel(options, modelPath);
        optionsSetThreads(options, 1);
        context = create(options);
        optionsFree(options);
        if (!context) throw new Error(`LocalVQE model load failed: ${lastError(0) || 'unknown error'}`);
        // Avoid hard gating consonants during double-talk; the timestamped
        // AEC reference is responsible for removing desktop playback.
        setNoiseGate(context, 0);
        self.postMessage({ type: 'ready' });
      });
  });
  return modulePromise;
}

function processStreaming(input) {
  if (input.length === 0) return new Float32Array();
  for (const sample of input) streamInput.push(sample);
  const bytes = 256 * 4;
  const inputPtr = moduleInstance._malloc(bytes);
  const referencePtr = moduleInstance._malloc(256 * 4);
  const outputPtr = moduleInstance._malloc(bytes);
  try {
    moduleInstance.HEAPF32.fill(0, referencePtr >> 2, (referencePtr >> 2) + 256);
    while (streamInput.length >= 256) {
      const hop = streamInput.splice(0, 256);
      moduleInstance.HEAPF32.set(hop, inputPtr >> 2);
      const result = processFrame(context, inputPtr, referencePtr, 256, outputPtr);
      if (result !== 0) throw new Error(`LocalVQE frame failed (${result})`);
      const enhanced = moduleInstance.HEAPF32.subarray(outputPtr >> 2, (outputPtr >> 2) + 256);
      for (const sample of enhanced) streamOutput.push(sample);
    }
    const output = new Float32Array(input.length);
    for (let index = 0; index < output.length; index += 1) {
      output[index] = streamOutput.length ? streamOutput.shift() : 0;
    }
    return output;
  } finally {
    moduleInstance._free(inputPtr);
    moduleInstance._free(referencePtr);
    moduleInstance._free(outputPtr);
  }
}

self.onmessage = async (event) => {
  const frameId = Number(event.data.frameId);
  try {
    if (event.data.type === 'init') {
      await load();
      return;
    }
    if (event.data.type === 'reset') {
      streamInput = [];
      streamOutput = new Array(128).fill(0);
      return;
    }
    if (event.data.type !== 'frame' && event.data.type !== 'batch') return;
    await load();
    const input = new Float32Array(event.data.frame);
    const output = processStreaming(input);
    self.postMessage({ type: event.data.type, frameId, frame: output.buffer }, [output.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', frameId, message: String(error && error.message || error) });
  }
};

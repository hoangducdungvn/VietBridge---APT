import { readFile } from 'node:fs/promises';
import * as ort from 'onnxruntime-web';

const models = [
  new URL('../public/models/silero_vad.onnx', import.meta.url),
  new URL('../../frontend/public/models/silero_vad.onnx', import.meta.url),
];

for (const modelUrl of models) {
  const model = await readFile(modelUrl);
  const session = await ort.InferenceSession.create(model, {
    executionProviders: ['wasm'],
  });

  const expectedInputs = ['input', 'state', 'sr'];
  const expectedOutputs = ['output', 'stateN'];
  for (const name of expectedInputs) {
    if (!session.inputNames.includes(name)) {
      throw new Error(`${modelUrl.pathname}: missing input ${name}`);
    }
  }
  for (const name of expectedOutputs) {
    if (!session.outputNames.includes(name)) {
      throw new Error(`${modelUrl.pathname}: missing output ${name}`);
    }
  }

  const result = await session.run({
    input: new ort.Tensor('float32', new Float32Array(512), [1, 512]),
    state: new ort.Tensor('float32', new Float32Array(256), [2, 1, 128]),
    sr: new ort.Tensor('int64', BigInt64Array.from([16000n]), [1]),
  });
  const probability = Number(result.output.data[0]);

  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error(`${modelUrl.pathname}: invalid probability ${probability}`);
  }
  if (result.stateN.dims.join('x') !== '2x1x128') {
    throw new Error(`${modelUrl.pathname}: invalid state shape ${result.stateN.dims.join('x')}`);
  }

  console.log(
    `PASS ${modelUrl.pathname}: input/state/sr -> output/stateN (${probability.toFixed(6)})`,
  );
}

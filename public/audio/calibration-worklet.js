class CalibrationCapture extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0]?.[0]
    if (input) this.port.postMessage({ frame: currentFrame, samples: input.slice() })
    for (const channel of outputs[0] ?? []) channel.fill(0)
    return true
  }
}
registerProcessor('calibration-capture', CalibrationCapture)

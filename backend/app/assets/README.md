# Bundled ASR preprocessing assets

`silero_vad_16k_op15.onnx` comes from Silero VAD v6.2.1:

https://github.com/snakers4/silero-vad/tree/v6.2.1/src/silero_vad/data

The model is pinned in the repository so application startup and transcription do
not download executable model content. `silero_vad_16k_op15.onnx.sha256` is checked
before the ONNX Runtime session is created. The upstream MIT license is stored in
`SILERO-VAD-LICENSE`.

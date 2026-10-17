# 可控音频样例

本目录音频为项目自行合成的 440Hz 单声道正弦测试音，不包含电台录音、歌曲或第三方节目。只供自动化测试使用，不作为产品默认电台。

- tone.mp3：MP3，64kbps，约 12 秒、低振幅。
- tone.aac：AAC-LC、ADTS，64kbps，约 12 秒、低振幅。
- tone.m3u8 与 segment-*.ts：AAC-LC 的分段 MPEG-TS HLS 样例。

MP3/AAC/HLS 使用 FFmpeg 7.1 生成。已提交二进制样例，执行浏览器测试不要求本机额外安装 FFmpeg；需要重新生成时运行已有脚本：

```bash
FFMPEG_BIN=<local-ffmpeg-path> node apps/web/scripts/generate-audio-fixtures.mjs
```

脚本只写本目录。生成工具及其二进制不随应用分发；合成音频内容由本项目产生，可用于本项目测试与再生成。

`normalization.wav` 用于校准检查：Python 标准库 `wave` 生成 16kHz、单声道 PCM16、2 秒的 440Hz 正弦，振幅为满幅 0.32，总计 64,044 字节。测试将基础音量设为 0.2；较高的源振幅用于验证衰减，不作为实际电台或默认用户音量。浏览器在明确的测试钩子中循环该有限样例，生产播放器不会循环直播。

无需 FFmpeg 即可单独再生成校准 WAV（生成参数已与提交样例逐字节核对）：

```sh
python3 - <<'PYTHON'
import math, struct, wave
with wave.open('apps/web/tests/fixtures/audio/normalization.wav', 'wb') as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(16000)
    audio.writeframes(b''.join(
        struct.pack('<h', round(32767 * 0.32 * math.sin(2 * math.pi * 440 * i / 16000)))
        for i in range(32000)
    ))
PYTHON
```

# 可控音频样例

本目录音频为项目自行合成的 440Hz 单声道正弦测试音，时长约 12 秒、低振幅，不包含电台录音、歌曲或第三方节目。只供自动化测试使用，不作为产品默认电台。

- tone.mp3：MP3，64kbps。
- tone.aac：AAC-LC、ADTS，64kbps。
- tone.m3u8 与 segment-*.ts：AAC-LC 的分段 MPEG-TS HLS 样例。

使用 FFmpeg 7.1 生成。已提交二进制样例，执行浏览器测试不要求本机额外安装 FFmpeg；需要重新生成时运行已有脚本：

```bash
FFMPEG_BIN=<local-ffmpeg-path> node scripts/generate-audio-fixtures.mjs
```

脚本只写本目录。生成工具及其二进制不随应用分发；合成音频内容由本项目产生，可用于本项目测试与再生成。

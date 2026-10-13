# Linkbox · AcFun 视频解析

一个适合部署在 **Vercel** 的小型中文工具导航站。主页提供 AcFun 解析入口；视频页可以输入 AcFun 公公开视频网址、查看封面/UP 主/时长、选择视频清晰度、在浏览器里尝试 HLS 预览，使用服务器 FFmpeg 转换、核验完整时长后再下载 MP4（v1.0.1）。

> **注意**：这个站点不要求用户提供 Cookie，不支持绕过登录、付费、DRM 等权限。不建议用来下载没有权利保存或再次传播的视频。

## 目录

```
index.html            首页 / 工具导航
acfun/index.html      AcFun 解析页面
assets/style.css      全部 UI 样式（响应式）
assets/app.js         首页搜索、视频解析及下载前端逻辑
api/parse.js          后端解析接口 POST /api/parse
api/download.js       后端 MP4 完整转换+验证 GET /api/download
lib/download-check.js  视频时长/大小校验及错误分类
lib/acfun.js          视频页面与 HLS 码流解析
lib/rate-limit.js     简易限流（单实例）
vercel.json           Vercel 部署配置
```

## Vercel 免费部署步骤

1. 解压这个项目，把**整个文件夹的内容**上传到 GitHub 新建仓库（例如 `linkbox-acfun`）。
2. 打开 [Vercel](https://vercel.com/new)，使用 GitHub 登录，选择 **Add New → Project / Import Git Repository**，选中你的仓库。
3. **Framework Preset** 选择 `Other`；**Build Command** 留空；**Output Directory** 不填。根目录是仓库根目录。
4. 点击 **Deploy**。部署完成后网站首页为 `/`，AcFun 解析页为 `/acfun/`。
5. 更新代码时只需向 GitHub 推送，Vercel 会自动重新部署。

项目依赖 `ffmpeg-static`，安装时会下载适用于部署环境的 FFmpeg。Vercel Node.js Functions 支持流式输出，但转换大视频受**函数运行时长（Hobby 通常最多 300 秒，需启用 Fluid Compute）**、出口流量以及 AcFun CDN 访问限制影响。项目对已知时长超过 30 分钟的视频不提供 MP4 服务端下载。下载超时、CDN 限制、缓存失效时可能失败；成功下载不作保证。

有些环境可能无法获取 FFmpeg 二进制文件，可在 Vercel 环境变量 `FFMPEG_PATH` 指向已存在的可执行文件；Vercel 默认不预装 FFmpeg，通常还是应使用 `ffmpeg-static`。

## 本地开发

- 安装 Node.js 20+。
- `npm install`
- `npm install -g vercel`（如未安装 Vercel CLI）
- `vercel dev`，打开命令行提示的本地地址。
- `npm test` 检查解析单元测试。
- `npm run check` 检查服务端和前端 JS 语法。

纯 HTML 静态页面也能直接本地预览，但 `/api/*` 仅在 `vercel dev` 或线上部署后可用。

## API

### `POST /api/parse`

请求：

```json
{"url":"https://www.acfun.cn/v/ac35457073"}
```

响应（示意）：

```json
{
  "success": true,
  "video": {
    "id": "ac35457073",
    "title": "示例标题",
    "uploader": "示例 UP",
    "duration": 120,
    "cover": "https://example.com/cover.jpg",
    "streams": [
      { "index": 0, "label": "1080P", "width": 1920, "height": 1080, "mime": "hls", "bitrate": 2300 }
    ]
  }
}
```

解析接口不会向浏览器暴露播放 CDN 的直链；下载端通过视频 AC 号和画质索引再次解析并取得地址。

### `GET /api/download?video=ac35457073&quality=0`

服务器先把视频转换到临时文件，核对大小与时长后才输出 MP4；若源站只返回短片段，将返回明确的 JSON 错误（HTTP 502），不再输出坏 MP4。临时文件仅存在于函数的 `/tmp` 中并在响应结束后删除。函数会重新请求 AcFun 视频页，耗费平台和 Vercel 资源。

## 已知限制与上线提示

- AcFun 网页结构及其 HLS CDN URL 随时可能变化。若出现 403 / 412 / 访问超时，服务端可能被限制访问，**不是前端错误**。
- 浏览器 HLS 预览依赖 AcFun CDN 的跨域许可。失败时可点击「在 AcFun 查看」。
- 某些 HLS 视频编码/音频封装无法用 `-c copy` 直接得到兼容 MP4，需要另一种转换策略。
- `ffmpeg-static` 将较大的可执行文件打包进 Vercel Function；请部署后先测试短公开视频，并观察部署日志与用量。
- 浏览器端支持 Chrome/Edge 的保存到磁盘 API；其他浏览器用 Blob 回退，特别大的视频会额外占用浏览器内存。
- 当前内存限流不是跨实例共享。面向公众正式开放前，建议接入 Upstash Redis 限流、验证码、流量阈值和滥用监控。
- 不要把其他站点任意 URL 作为后端抓取地址；目前 API 只允许 AcFun 视频页。
- 本示例未包含账号、数据存储或付费功能，也未进行真实 AcFun 线上端到端测试。

## 版权与使用

仅供学习与处理有权访问和保存的公开视频。请尊重作者版权与 AcFun 的使用规则。AcFun 为相关权利人商标，本项目与 AcFun 无官方关联。

### 部署自检

部署后打开 `/api/health`，若返回 `{"status":"ok","ffmpegAvailable":true}`，说明服务端能找到 FFmpeg 文件。注意：文件存在不代表第三方 CDN 必然能够连接，也不代表所有视频可转换。

## 2026-10-14 下载缺陷修复（v1.0.1）

复现样本 `ac48742734` 原下载文件只有 2,022 字节，视频流约 0.043 秒（原视频约 398 秒）。此前服务端在 FFmpeg 开始运行时立刻回 `200 video/mp4`，即使 HLS 提前结束也会把截断文件下载下来。

本次修改：
- 先转换到服务器临时 MP4，FFmpeg 退出码、输出文件大小和实际时长必须通过校验，才返回下载响应；错误返回 502 JSON。
- 遇到源站 403/404/超时显示对应的简短提示。
- 网站下载按钮改为 fetch 接收反馈，显示进度/错误，Chrome/Edge 优先直接保存到磁盘。
- 新增与复现文件对应的自动化单元测试。

**重要限制：** 本修复保证不会把明显不完整的文件误报为下载成功，**不代表**已修复 AcFun CDN 或 Vercel 环境导致的 HLS 提前结束。要定位源头需要在新版本部署后查看 Vercel → Logs → `api/download` 运行记录（以 `[Linkbox AcFun download failure]` 开头，不记录带签名参数的 CDN URL）。Vercel Hobby 函数时限通常最多 300 秒，且临时存储空间和数据传输都有实际限制。若连续失败，稳定的 MP4 下载需要改由具备持久后台任务能力的下载服务（例如独立服务器）负责，Vercel 保留网页和解析接口。

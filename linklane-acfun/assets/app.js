(() => {
  'use strict';
  document.querySelectorAll('[data-year]').forEach((node) => { node.textContent = new Date().getFullYear(); });

  if (document.body.dataset.page === 'home') setupHome();
  if (document.body.dataset.page === 'acfun') setupAcfun();

  function setupHome() {
    const search = document.getElementById('tool-search');
    const chips = Array.from(document.querySelectorAll('[data-filter]'));
    const cards = Array.from(document.querySelectorAll('[data-category]'));
    const empty = document.getElementById('empty-search');
    let category = 'all';
    function filter() {
      const query = search.value.trim().toLowerCase();
      let count = 0;
      cards.forEach(card => {
        const hit = (category === 'all' || card.dataset.category === category) &&
          (!query || `${card.dataset.search} ${card.textContent}`.toLowerCase().includes(query));
        card.hidden = !hit;
        if (hit) count++;
      });
      empty.hidden = count > 0;
    }
    search.addEventListener('input', filter);
    chips.forEach(chip => chip.addEventListener('click', () => {
      category = chip.dataset.filter;
      chips.forEach(c => c.classList.toggle('is-active', c === chip));
      filter();
    }));
    document.addEventListener('keydown', e => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        e.preventDefault(); search.focus();
      }
    });
  }

  function setupAcfun() {
    const form = document.getElementById('parse-form');
    const input = document.getElementById('video-url');
    const submit = document.getElementById('submit-button');
    const submitLabel = document.getElementById('submit-label');
    const status = document.getElementById('form-status');
    const results = document.getElementById('result-panel');
    const empty = document.getElementById('empty-panel');
    const qualityGrid = document.getElementById('quality-grid');
    const download = document.getElementById('download-button');
    const downloadStatus = document.getElementById('download-status');
    let downloading = false;
    const preview = document.getElementById('preview-button');
    const modal = document.getElementById('preview-modal');
    const player = document.getElementById('video-player');
    const modalNote = document.getElementById('modal-note');
    let current = null;
    let selected = 0;
    let hls = null;

    function setStatus(message, type = 'error') {
      status.hidden = !message;
      status.textContent = message;
      status.className = 'form-status' + (type === 'loading' ? ' is-loading' : type === 'success' ? ' is-success' : '');
    }
    function busy(on) {
      submit.disabled = on;
      submit.classList.toggle('button-loading', on);
      submitLabel.textContent = on ? '正在解析...' : '开始解析';
    }
    function formatDuration(seconds) {
      if (seconds == null || !Number.isFinite(seconds)) return '时长未知';
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      return `${m}:${String(s).padStart(2, '0')}`;
    }
    function formatBitrate(value) {
      return value && value > 0 ? `${(value / 1000).toFixed(0)} kbps` : '可用视频流';
    }
    function currentStream() { return current?.streams[selected]; }
    function setDownloadStatus(message, type = 'loading') {
      downloadStatus.textContent = message;
      downloadStatus.hidden = !message;
      downloadStatus.className = 'download-status' + (type === 'error' ? ' is-error' : type === 'success' ? ' is-success' : '');
    }

    function updateDownload() {
      const stream = currentStream();
      if (!stream) return;
      const tooLong = current.duration != null && current.duration > 1800;
      download.href = `/api/download?video=${encodeURIComponent(current.id)}&quality=${stream.index}`;
      download.setAttribute('aria-disabled', tooLong || downloading ? 'true' : 'false');
      download.classList.toggle('is-disabled', tooLong || downloading);
      download.title = tooLong ? '本版本仅支持下载 30 分钟以内的视频' : '将视频实时转换为 MP4';
      preview.disabled = !stream;
    }
    function pickQuality(index) {
      selected = index;
      qualityGrid.querySelectorAll('button').forEach((button, i) => {
        const active = index === i;
        button.classList.toggle('is-selected', active);
        button.setAttribute('aria-checked', String(active));
      });
      updateDownload();
    }
    function renderVideo(video) {
      current = video;
      selected = 0;
      setDownloadStatus('');
      document.getElementById('video-title').textContent = video.title;
      document.getElementById('video-uploader').textContent = `UP 主 · ${video.uploader}`;
      document.getElementById('video-duration').innerHTML = '<svg class="icon"><use href="/assets/icons.svg#clock"/></svg>';
      document.getElementById('video-duration').append(document.createTextNode(formatDuration(video.duration)));
      document.getElementById('video-parts').innerHTML = '<svg class="icon"><use href="/assets/icons.svg#layers"/></svg>';
      document.getElementById('video-parts').append(document.createTextNode(video.parts > 1 ? `${video.parts} P` : '单 P'));
      document.getElementById('original-link').href = video.url;
      const cover = document.getElementById('video-cover');
      if (video.cover) { cover.src = video.cover; cover.style.visibility = 'visible'; }
      else { cover.removeAttribute('src'); cover.style.visibility = 'hidden'; }
      document.getElementById('quality-count').textContent = `${video.streams.length} 种可用画质`;
      qualityGrid.replaceChildren();
      video.streams.forEach((stream, index) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'quality-option';
        option.setAttribute('role', 'radio');
        const strong = document.createElement('strong');
        strong.textContent = stream.label;
        const tiny = document.createElement('span');
        tiny.textContent = stream.height ? `${stream.width || '—'} × ${stream.height}` : formatBitrate(stream.bitrate);
        option.append(strong, tiny);
        option.addEventListener('click', () => pickQuality(index));
        qualityGrid.append(option);
      });
      pickQuality(0);
      results.hidden = false;
      empty.hidden = true;
      results.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const url = input.value.trim();
      if (!/^ac\d+(?:_\d+)?$/i.test(url) && !/^https?:\/\/(?:www\.|m\.)?acfun\.cn\/v\/ac\d+(?:_\d+)?(?:[/?#].*)?$/i.test(url)) {
        setStatus('请输入有效的 AcFun 视频链接，例如 https://www.acfun.cn/v/ac35457073');
        input.focus(); return;
      }
      busy(true); setStatus('正在连接 AcFun 并获取公开视频信息…', 'loading');
      results.hidden = true;
      empty.hidden = false;
      current = null;
      try {
        const response = await fetch('/api/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `解析失败（${response.status}）`);
        if (!payload.video?.streams?.length) throw new Error('视频未返回可用画质。');
        setStatus('解析成功！选择下方画质即可预览或下载。', 'success');
        renderVideo(payload.video);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : '发生未知错误，请稍后再试。');
      } finally { busy(false); }
    });

    document.getElementById('clear-button').addEventListener('click', () => {
      input.value = '';
      setStatus('');
      results.hidden = true;
      empty.hidden = false;
      current = null;
      input.focus();
    });
    document.getElementById('paste-button').addEventListener('click', async () => {
      try {
        input.value = await navigator.clipboard.readText();
        input.focus(); setStatus('');
      } catch (_) {
        setStatus('浏览器未允许读取剪贴板，请按 Ctrl+V 手动粘贴。');
        input.focus();
      }
    });

    download.addEventListener('click', async (event) => {
      event.preventDefault();
      if (downloading || !current) return;
      if (current.duration != null && current.duration > 1800) {
        setDownloadStatus('此版本仅支持 30 分钟以内的视频。较长视频可用本地 yt-dlp。', 'error');
        return;
      }
      const video = current;
      const stream = currentStream();
      if (!stream) return;
      const name = `${video.id}-${stream.label.replace(/[^a-z0-9-]/gi, '') || 'video'}.mp4`;
      let fileHandle = null;
      // Must call showSaveFilePicker synchronously from the user's click.
      // This prevents having to keep a large Blob in Chrome's memory.
      if (typeof window.showSaveFilePicker === 'function') {
        try {
          fileHandle = await window.showSaveFilePicker({
            suggestedName: name,
            types: [{ description: 'MP4 视频', accept: { 'video/mp4': ['.mp4'] } }]
          });
        } catch (error) {
          if (error?.name === 'AbortError') return;
          fileHandle = null; // Unsupported permission: fall back to browser download.
        }
      }

      downloading = true;
      updateDownload();
      setDownloadStatus('正在准备 MP4：服务器会先完整转换并验证视频，可能需要几十秒…');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 290_000);
      let writer = null;
      try {
        const url = `/api/download?video=${encodeURIComponent(video.id)}&quality=${stream.index}`;
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok || !response.headers.get('content-type')?.includes('video/mp4')) {
          let message = `下载失败（HTTP ${response.status}）`;
          try { message = (await response.json()).error || message; } catch (_) { /* HTML/server error */ }
          throw new Error(message);
        }
        const total = Number(response.headers.get('content-length')) || 0;
        const reader = response.body?.getReader();
        if (!reader) throw new Error('浏览器无法读取下载流，请更换最新版浏览器。');
        if (fileHandle) writer = await fileHandle.createWritable();
        const chunks = [];
        let received = 0;
        let previous = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (writer) await writer.write(value);
          else chunks.push(value);
          // Avoid re-rendering on every small network chunk.
          if (received - previous > 512 * 1024 || (total && received === total)) {
            previous = received;
            const pct = total ? ` / ${(total / 1048576).toFixed(1)} MB (${Math.floor(received / total * 100)}%)` : '';
            setDownloadStatus(`正在接收文件：${(received / 1048576).toFixed(1)} MB${pct}`);
          }
        }
        if (total && received !== total) throw new Error('视频传输中断，文件大小与服务器标记不一致。');
        if (writer) {
          await writer.close(); writer = null;
        } else {
          const fileUrl = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
          const link = document.createElement('a');
          link.href = fileUrl;
          link.download = name;
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(fileUrl), 30_000);
        }
        setDownloadStatus('MP4 完整下载成功！', 'success');
      } catch (error) {
        if (writer) await writer.abort().catch(() => {});
        setDownloadStatus(error.name === 'AbortError' ? '下载超时，请查看服务器日志或稍后重试。' : (error.message || '下载失败。'), 'error');
      } finally {
        clearTimeout(timeout);
        downloading = false;
        updateDownload();
      }
    });

    function closePreview() {
      if (hls) { hls.destroy(); hls = null; }
      player.pause(); player.removeAttribute('src'); player.load();
      modal.hidden = true;
      document.body.style.overflow = '';
    }
    function loadHlsLibrary() {
      if (window.Hls) return Promise.resolve(window.Hls);
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const timeout = setTimeout(() => reject(new Error('播放器加载超时')), 8000);
        script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
        script.async = true;
        script.onload = () => { clearTimeout(timeout); resolve(window.Hls); };
        script.onerror = () => { clearTimeout(timeout); reject(new Error('播放器加载失败')); };
        document.head.append(script);
      });
    }
    preview.addEventListener('click', async () => {
      const stream = currentStream();
      if (!stream || !current) return;
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
      document.getElementById('modal-title').textContent = current.title;
      modalNote.textContent = '播放依赖 AcFun CDN 是否允许跨域访问。如果无法播放，请前往原视频页面观看。';
      try {
        if (player.canPlayType('application/vnd.apple.mpegurl')) {
          player.src = stream.url;
          await player.play();
        } else {
          const Hls = await loadHlsLibrary();
          if (!Hls?.isSupported()) throw new Error('浏览器不支持 HLS 播放');
          if (modal.hidden) return;
          hls = new Hls({ enableWorker: true, maxBufferLength: 25 });
          hls.loadSource(stream.url);
          hls.attachMedia(player);
          hls.on(Hls.Events.MANIFEST_PARSED, () => player.play().catch(() => {}));
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) modalNote.textContent = '浏览器无法读取该视频流（可能是 CORS 或源站限制）。请返回 AcFun 原站观看。';
          });
        }
      } catch (_) { modalNote.textContent = '无法启动预览，请前往 AcFun 原站观看。'; }
    });
    document.getElementById('close-preview').addEventListener('click', closePreview);
    modal.addEventListener('click', e => { if (e.target === modal) closePreview(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closePreview(); });
    const prefill = new URLSearchParams(location.search).get('url');
    if (prefill) input.value = prefill;
  }
})();

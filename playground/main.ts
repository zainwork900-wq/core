import * as core from '@diffusionstudio/core-v4';
import {
  state, addClip, removeClip, selectClip, nextId,
  renderTimeline, renderProperties, renderMediaBin,
  formatTime, getMediaType, type ClipData
} from './editor';

// === State ===
let composition: any = null;
let playerEl: HTMLDivElement | null = null;
let resizeObserver: ResizeObserver | null = null;

// === Composition Builder ===
async function buildComposition(): Promise<any> {
  const comp = new core.Composition({
    background: '#000000',
  });

  // Build video/image clips
  const visualClips = state.clips.filter(c => (c.type === 'video' || c.type === 'image') && c.source);
  const audioClips = state.clips.filter(c => c.type === 'audio' && c.source);
  const textClips = state.clips.filter(c => c.type === 'text');

  // Video/Image layers
  if (visualClips.length > 0) {
    const layer = new core.Layer();
    await comp.add(layer);

    for (const clip of visualClips) {
      try {
        const opts: any = {
          delay: `${clip.startTime}s`,
          duration: `${clip.duration}s`,
        };
        if (clip.effects && clip.effects.length > 0) {
          opts.effects = clip.effects;
        }
        if (clip.type === 'video') {
          await layer.add(new core.VideoClip(clip.source, opts));
        } else {
          await layer.add(new core.ImageClip(clip.source, opts));
        }
      } catch (e) {
        console.error('Failed to add visual clip:', clip.name, e);
      }
    }
  }

  // Text layers
  for (const clip of textClips) {
    try {
      const layer = new core.Layer();
      await comp.add(layer);
      await layer.add(new core.TextClip({
        text: clip.text || '',
        fontSize: clip.fontSize || 48,
        color: (clip.fontColor || '#ffffff') as any,
        x: `${clip.x || 50}%`,
        y: `${clip.y || 50}%`,
        align: 'center',
        baseline: 'middle',
        delay: `${clip.startTime}s`,
        duration: `${clip.duration}s`,
        strokes: [{ width: 2, color: '#000000' }],
      }));
    } catch (e) {
      console.error('Failed to add text clip:', clip.name, e);
    }
  }

  // Audio layers
  if (audioClips.length > 0) {
    const layer = new core.Layer();
    await comp.add(layer);
    for (const clip of audioClips) {
      try {
        await layer.add(new core.AudioClip(clip.source, {
          delay: `${clip.startTime}s`,
          duration: `${clip.duration}s`,
          volume: 1,
        }));
      } catch (e) {
        console.error('Failed to add audio clip:', clip.name, e);
      }
    }
  }

  return comp;
}

// === File Handling ===
async function handleFiles(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    const mediaType = getMediaType(file);
    if (!mediaType) continue;

    const url = URL.createObjectURL(file);
    const clip: ClipData = {
      id: nextId(),
      type: mediaType,
      name: file.name.length > 25 ? file.name.substring(0, 22) + '...' : file.name,
      file,
      url,
      startTime: findNextSlot(),
      duration: 5,
      trimStart: 0,
      trimEnd: 0,
      layerIndex: 0,
      effects: [],
    };

    // Load source
    try {
      clip.source = await core.Source.from(url);
      // Try to get actual duration
      if (clip.type === 'video' || clip.type === 'audio') {
        const tempMedia = document.createElement(clip.type === 'video' ? 'video' : 'audio');
        tempMedia.src = url;
        await new Promise<void>((resolve) => {
          tempMedia.onloadedmetadata = () => {
            clip.duration = tempMedia.duration || 5;
            resolve();
          };
          tempMedia.onerror = () => resolve();
          setTimeout(() => resolve(), 3000);
        });
      }
    } catch (e) {
      console.error('Failed to load source:', file.name, e);
    }

    addClip(clip);
  }

  renderMediaBin();
  await refreshPlayer();
}

function findNextSlot(): number {
  if (state.clips.length === 0) return 0;
  let max = 0;
  for (const c of state.clips) {
    const end = c.startTime + c.duration;
    if (end > max) max = end;
  }
  return max;
}

// === Player ===
async function refreshPlayer() {
  if (!playerEl) return;

  try {
    // Cleanup old composition
    if (composition) {
      try { composition.pause(); } catch (e) {}
      playerEl.innerHTML = '';
    }

    composition = await buildComposition();

    if (!composition) return;

    // Mount to DOM
    composition.mount(playerEl);

    // Resize handler
    const container = document.getElementById('player-container');
    if (container) {
      if (resizeObserver) resizeObserver.disconnect();
      const handleResize = () => {
        if (!composition || !container || !playerEl) return;
        try {
          const w = composition.width || 1920;
          const h = composition.height || 1080;
          const scale = Math.min(
            container.clientWidth / w,
            container.clientHeight / h
          );
          playerEl.style.width = w + 'px';
          playerEl.style.height = h + 'px';
          playerEl.style.transform = `scale(${scale})`;
          playerEl.style.transformOrigin = 'center';
        } catch (e) {}
      };
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(container);
      handleResize();
    }

    // Seek to start
    composition.seek(0);
    updateTimeDisplay();
    setupCompositionEvents();

  } catch (e) {
    console.error('Failed to build composition:', e);
  }
}

function setupCompositionEvents() {
  if (!composition) return;

  composition.on('playback:time', () => {
    updateTimeDisplay();
    if (composition) updateCursor(composition.currentTime);
  });

  composition.on('playback:end', () => {
    showPlayState(false);
  });
}

function showPlayState(playing: boolean) {
  const playBtn = document.getElementById('btn-play');
  const pauseBtn = document.getElementById('btn-pause');
  if (playBtn) playBtn.style.display = playing ? 'none' : '';
  if (pauseBtn) pauseBtn.style.display = playing ? '' : 'none';
  state.isPlaying = playing;
}

function updateTimeDisplay() {
  const el = document.getElementById('time-display');
  if (!el) return;
  if (composition) {
    el.textContent = `${formatTime(composition.currentTime || 0)} / ${formatTime(composition.duration || state.totalDuration)}`;
  } else {
    el.textContent = `00:00 / ${formatTime(state.totalDuration)}`;
  }
}

function updateCursor(time: number) {
  const cursor = document.getElementById('timeline-cursor');
  if (!cursor) return;
  cursor.style.left = (time * 60 * state.zoom) + 'px';
}

// === Controls ===
function setupControls() {
  const playBtn = document.getElementById('btn-play');
  const pauseBtn = document.getElementById('btn-pause');
  const backBtn = document.getElementById('btn-back');
  const fwdBtn = document.getElementById('btn-forward');

  playBtn?.addEventListener('click', async () => {
    if (!composition) {
      await refreshPlayer();
    }
    if (composition) {
      try {
        composition.play();
        showPlayState(true);
      } catch (e) {
        console.error('Play failed:', e);
        // Try rebuilding
        await refreshPlayer();
        if (composition) {
          composition.play();
          showPlayState(true);
        }
      }
    }
  });

  pauseBtn?.addEventListener('click', () => {
    if (composition) {
      composition.pause();
      showPlayState(false);
    }
  });

  backBtn?.addEventListener('click', () => {
    if (composition) {
      composition.seek(0);
      updateTimeDisplay();
      updateCursor(0);
    }
  });

  fwdBtn?.addEventListener('click', () => {
    if (composition) {
      const dur = composition.duration || state.totalDuration;
      composition.seek(dur);
      updateTimeDisplay();
      updateCursor(dur);
    }
  });

  // Timeline seek
  const scroll = document.getElementById('timeline-scroll');
  scroll?.addEventListener('click', (e) => {
    if (!scroll) return;
    const rect = scroll.getBoundingClientRect();
    const pos = (e.clientX - rect.left + scroll.scrollLeft) / (60 * state.zoom);
    const clamped = Math.max(0, pos);
    if (composition) {
      composition.seek(clamped);
      updateTimeDisplay();
    }
    updateCursor(clamped);
  });
}

// === Zoom ===
function setupZoom() {
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
    state.zoom = Math.min(4, state.zoom + 0.25);
    renderTimeline();
  });
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    state.zoom = Math.max(0.25, state.zoom - 0.25);
    renderTimeline();
  });
}

// === Text Modal ===
function setupTextModal() {
  const modal = document.getElementById('text-modal');
  document.getElementById('btn-add-text')?.addEventListener('click', () => {
    modal!.style.display = '';
    const input = document.getElementById('text-input') as HTMLInputElement;
    input.value = '';
    input.focus();
  });

  document.getElementById('text-cancel')?.addEventListener('click', () => {
    modal!.style.display = 'none';
  });

  document.getElementById('text-confirm')?.addEventListener('click', async () => {
    const text = (document.getElementById('text-input') as HTMLInputElement).value.trim();
    if (!text) return;

    const clip: ClipData = {
      id: nextId(),
      type: 'text',
      name: text.length > 20 ? text.substring(0, 17) + '...' : text,
      text,
      fontSize: parseFloat((document.getElementById('text-size') as HTMLInputElement).value) || 48,
      fontColor: (document.getElementById('text-color') as HTMLInputElement).value || '#ffffff',
      x: parseFloat((document.getElementById('text-x') as HTMLInputElement).value) || 50,
      y: parseFloat((document.getElementById('text-y') as HTMLInputElement).value) || 50,
      startTime: findNextSlot(),
      duration: parseFloat((document.getElementById('text-duration') as HTMLInputElement).value) || 3,
      trimStart: 0,
      trimEnd: 0,
      layerIndex: 1,
    };

    addClip(clip);
    renderMediaBin();
    modal!.style.display = 'none';
    await refreshPlayer();
  });
}

// === Export ===
function setupExport() {
  const modal = document.getElementById('export-modal');

  document.getElementById('btn-export')?.addEventListener('click', () => {
    if (state.clips.length === 0) {
      alert('Add some media first before exporting!');
      return;
    }
    modal!.style.display = '';
  });

  document.getElementById('export-cancel')?.addEventListener('click', () => {
    modal!.style.display = 'none';
  });

  document.getElementById('export-confirm')?.addEventListener('click', async () => {
    modal!.style.display = 'none';
    await doExport();
  });
}

async function doExport() {
  const overlay = document.getElementById('progress-overlay');
  const progressText = document.getElementById('progress-text');
  const progressFill = document.getElementById('progress-fill');
  if (!overlay) return;

  // Build fresh composition for export
  try {
    const exportComp = await buildComposition();
    if (!exportComp) {
      alert('Nothing to export!');
      return;
    }

    overlay.style.display = 'flex';
    const fps = parseInt((document.getElementById('fps-select') as HTMLSelectElement).value) || 30;

    const encoder = new core.Encoder(exportComp, { debug: true, video: { fps } });

    overlay.onclick = () => encoder.cancel();

    encoder.onProgress = (event: any) => {
      const pct = Math.round(event.progress * 100 / event.total);
      if (progressText) progressText.textContent = pct + '%';
      if (progressFill) progressFill.style.width = pct + '%';
    };

    const fileHandle = await (window as any).showSaveFilePicker({
      suggestedName: 'edited_video.mp4',
      types: [{ description: 'Video File', accept: { 'video/mp4': ['.mp4'] } }],
    });

    await encoder.render(fileHandle);
    alert('Export complete!');
  } catch (e: any) {
    if (e?.name !== 'AbortError' && e?.message !== 'User cancelled a request.') {
      alert('Export failed: ' + e.message);
    }
  } finally {
    overlay.style.display = 'none';
  }
}

// === Upload Screen ===
function setupUploadScreen() {
  const uploadScreen = document.getElementById('upload-screen');
  const editorScreen = document.getElementById('editor-screen');
  const fileInput = document.getElementById('fileInput') as HTMLInputElement;
  const uploadBox = document.querySelector('.upload-box') as HTMLDivElement;

  function showEditor() {
    uploadScreen!.style.display = 'none';
    editorScreen!.style.display = '';
    playerEl = document.getElementById('player') as HTMLDivElement;
    renderTimeline();
  }

  fileInput.addEventListener('change', async () => {
    if (fileInput.files?.length) {
      showEditor();
      await handleFiles(fileInput.files);
    }
  });

  uploadBox.addEventListener('dragover', (e) => { e.preventDefault(); uploadBox.classList.add('dragover'); });
  uploadBox.addEventListener('dragleave', () => uploadBox.classList.remove('dragover'));
  uploadBox.addEventListener('drop', async (e) => {
    e.preventDefault();
    uploadBox.classList.remove('dragover');
    if (e.dataTransfer?.files.length) {
      showEditor();
      await handleFiles(e.dataTransfer.files);
    }
  });
}

// === Media Add Button ===
function setupMediaAdd() {
  const btn = document.getElementById('btn-add-media');
  const input = document.getElementById('mediaInput') as HTMLInputElement;
  btn?.addEventListener('click', () => input.click());
  input?.addEventListener('change', async () => {
    if (input.files?.length) {
      await handleFiles(input.files);
      input.value = '';
    }
  });
}

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
  setupUploadScreen();

  const observer = new MutationObserver(() => {
    const editor = document.getElementById('editor-screen');
    if (editor && editor.style.display !== 'none') {
      observer.disconnect();
      playerEl = document.getElementById('player') as HTMLDivElement;
      setupControls();
      setupZoom();
      setupTextModal();
      setupExport();
      setupMediaAdd();
    }
  });
  observer.observe(document.body, { subtree: true, attributes: true });
});

// Polyfill
if (!('showSaveFilePicker' in window)) {
  Object.assign(window, {
    showSaveFilePicker: async () => 'edited_video.mp4'
  });
}

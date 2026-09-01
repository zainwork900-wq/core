import * as core from '@diffusionstudio/core-v4';
import {
  state, addClip, removeClip, selectClip, nextId,
  renderTimeline, renderProperties, renderMediaBin,
  formatTime, getMediaType, type ClipData
} from './editor';

// === Composition ===
let composition: any;

async function buildComposition(): Promise<any> {
  const comp = new core.Composition({
    background: '#000000',
  });

  const videoClips = state.clips.filter(c => c.type === 'video' || c.type === 'image');
  const audioClips = state.clips.filter(c => c.type === 'audio');
  const textClips = state.clips.filter(c => c.type === 'text');

  // Video/Image layer
  if (videoClips.length > 0) {
    const videoLayer = new core.Layer();
    await comp.add(videoLayer);

    for (const clip of videoClips) {
      if (!clip.source) continue;
      const delayStr = `${clip.startTime}s`;
      if (clip.type === 'video') {
        const vc = new core.VideoClip(clip.source, {
          delay: delayStr as any,
          duration: `${clip.duration}s` as any,
          effects: clip.effects || [],
        });
        await videoLayer.add(vc);
      } else if (clip.type === 'image') {
        const ic = new core.ImageClip(clip.source, {
          delay: delayStr as any,
          duration: `${clip.duration}s` as any,
          effects: clip.effects || [],
        });
        await videoLayer.add(ic);
      }
    }
  }

  // Text layer
  for (const clip of textClips) {
    const textLayer = new core.Layer();
    await comp.add(textLayer);
    await textLayer.add(new core.TextClip({
      text: clip.text || '',
      fontSize: clip.fontSize || 48,
      color: (clip.fontColor || '#ffffff') as `#${string}`,
      x: `${clip.x || 50}%` as any,
      y: `${clip.y || 50}%` as any,
      align: 'center',
      baseline: 'middle',
      delay: `${clip.startTime}s` as any,
      duration: `${clip.duration}s` as any,
    }));
  }

  // Audio layer
  if (audioClips.length > 0) {
    const audioLayer = new core.Layer();
    await comp.add(audioLayer);
    for (const clip of audioClips) {
      if (!clip.source) continue;
      const ac = new core.AudioClip(clip.source, {
        delay: `${clip.startTime}s` as any,
        duration: `${clip.duration}s` as any,
      });
      await audioLayer.add(ac);
    }
  }

  return comp;
}

// === File Upload Handling ===
async function handleFiles(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    const mediaType = getMediaType(file);
    if (!mediaType) continue;

    const url = URL.createObjectURL(file);
    const clip: ClipData = {
      id: nextId(),
      type: mediaType,
      name: file.name,
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
      if (mediaType === 'video') {
        clip.source = await core.Source.from(url);
        clip.duration = 5;
      } else if (mediaType === 'audio') {
        clip.source = await core.Source.from(url);
        clip.duration = 5;
      } else if (mediaType === 'image') {
        clip.source = await core.Source.from(url);
        clip.duration = 5;
      }
    } catch (e) {
      console.error('Failed to load source:', file.name, e);
      clip.duration = 5;
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
  try {
    composition = await buildComposition();
    const playerEl = document.getElementById('player');
    if (!playerEl) return;

    composition.mount(playerEl);

    const container = document.getElementById('player-container');
    if (container) {
      const handleResize = () => {
        if (!composition || !container) return;
        const scale = Math.min(
          container.clientWidth / composition.width,
          container.clientHeight / composition.height
        );
        playerEl.style.width = composition.width + 'px';
        playerEl.style.height = composition.height + 'px';
        playerEl.style.transform = `scale(${scale})`;
        playerEl.style.transformOrigin = 'center';
      };
      new ResizeObserver(handleResize).observe(container);
      handleResize();
    }

    composition.seek(0);
    updateTimeDisplay();
  } catch (e) {
    console.error('Build composition failed:', e);
  }
}

function updateTimeDisplay() {
  const el = document.getElementById('time-display');
  if (!el || !composition) return;
  el.textContent = `${formatTime(composition.currentTime)} / ${formatTime(composition.duration || state.totalDuration)}`;
}

// === Controls ===
function setupControls() {
  document.getElementById('btn-play')?.addEventListener('click', () => {
    composition?.play();
    document.getElementById('btn-play')!.style.display = 'none';
    document.getElementById('btn-pause')!.style.display = '';
    state.isPlaying = true;
  });

  document.getElementById('btn-pause')?.addEventListener('click', () => {
    composition?.pause();
    document.getElementById('btn-pause')!.style.display = 'none';
    document.getElementById('btn-play')!.style.display = '';
    state.isPlaying = false;
  });

  document.getElementById('btn-back')?.addEventListener('click', () => {
    composition?.seek(0);
    updateTimeDisplay();
  });

  document.getElementById('btn-forward')?.addEventListener('click', () => {
    if (composition) composition.seek(composition.duration || state.totalDuration);
    updateTimeDisplay();
  });

  composition?.on('playback:time', () => updateTimeDisplay());
  composition?.on('playback:end', () => {
    const pauseBtn = document.getElementById('btn-pause');
    const playBtn = document.getElementById('btn-play');
    if (pauseBtn) pauseBtn.style.display = 'none';
    if (playBtn) playBtn.style.display = '';
    state.isPlaying = false;
  });

  // Timeline seek
  const scroll = document.getElementById('timeline-scroll');
  scroll?.addEventListener('click', (e) => {
    if (!scroll || !composition) return;
    const rect = scroll.getBoundingClientRect();
    const pos = (e.clientX - rect.left + scroll.scrollLeft) / (60 * state.zoom);
    composition.seek(Math.max(0, pos));
    updateTimeDisplay();
    updateCursor(pos);
  });

  // Cursor update on playback
  composition?.on('playback:time', () => {
    if (composition) updateCursor(composition.currentTime);
  });
}

function updateCursor(time: number) {
  const cursor = document.getElementById('timeline-cursor');
  if (!cursor) return;
  cursor.style.left = (time * 60 * state.zoom) + 'px';
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
    (document.getElementById('text-input') as HTMLInputElement).value = '';
    (document.getElementById('text-input') as HTMLInputElement).focus();
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
      name: text.substring(0, 20),
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
  if (!overlay || !composition) return;

  overlay.style.display = 'flex';
  const fps = parseInt((document.getElementById('fps-select') as HTMLSelectElement).value) || 30;

  try {
    const encoder = new core.Encoder(composition, { debug: true, video: { fps } });

    overlay.addEventListener('click', () => encoder.cancel());

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
  } catch (e: any) {
    if (e?.name !== 'AbortError') alert('Export failed: ' + e.message);
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
    renderTimeline();
  }

  fileInput.addEventListener('change', async () => {
    if (fileInput.files?.length) {
      await handleFiles(fileInput.files);
      showEditor();
    }
  });

  // Drag and drop
  uploadBox.addEventListener('dragover', (e) => { e.preventDefault(); uploadBox.classList.add('dragover'); });
  uploadBox.addEventListener('dragleave', () => uploadBox.classList.remove('dragover'));
  uploadBox.addEventListener('drop', async (e) => {
    e.preventDefault();
    uploadBox.classList.remove('dragover');
    if (e.dataTransfer?.files.length) {
      await handleFiles(e.dataTransfer.files);
      showEditor();
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

  // These run after editor is shown
  const observer = new MutationObserver(() => {
    const editor = document.getElementById('editor-screen');
    if (editor && editor.style.display !== 'none') {
      observer.disconnect();
      // Init composition
      composition = null;
      setupControls();
      setupZoom();
      setupTextModal();
      setupExport();
      setupMediaAdd();
    }
  });
  observer.observe(document.body, { subtree: true, attributes: true });
});

// File picker polyfill
if (!('showSaveFilePicker' in window)) {
  Object.assign(window, {
    showSaveFilePicker: async () => 'edited_video.mp4'
  });
}

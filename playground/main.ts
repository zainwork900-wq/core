import * as core from '@diffusionstudio/core-v4';
import {
  state, addClip, removeClip, selectClip, nextId, getSelectedClip,
  updateClip, splitClipAtPlayhead, duplicateClip, bringToFront, sendToBack, undo, redo,
  renderTimeline, renderProperties, renderMediaBin, renderEffects, renderTransitions,
  setupTabs, formatTime, getMediaType, saveProject, loadProject, setPlayheadGetter,
  type ClipData
} from './editor';

// ============================================================
// MAIN — Full Video Editor Wiring
// ============================================================

let composition: any = null;
let playerEl: HTMLDivElement | null = null;
let resizeObserver: ResizeObserver | null = null;
let isRebuilding = false;

// === Source Loading ===
async function loadSource(url: string, type: string): Promise<any> {
  try {
    if (type === 'video') {
      const src = await core.Source.from<core.VideoSource>(url, { mimeType: 'video/mp4' });
      return src;
    } else if (type === 'audio') {
      const src = await core.Source.from<core.AudioSource>(url, { mimeType: 'audio/mpeg' });
      return src;
    } else if (type === 'image') {
      const src = await core.Source.from<core.ImageSource>(url, { mimeType: 'image/png' });
      return src;
    }
    return await core.Source.from(url);
  } catch (e) {
    console.error('Source load failed, retrying without mime:', e);
    return await core.Source.from(url);
  }
}

// === Composition Builder ===
async function buildComposition(): Promise<any> {
  const comp = new core.Composition({
    width: 1920,
    height: 1080,
    background: '#000000',
  });

  const visualClips = state.clips.filter(c => (c.type === 'video' || c.type === 'image') && c.source);
  const audioClips = state.clips.filter(c => c.type === 'audio' && c.source);
  const textClips = state.clips.filter(c => c.type === 'text');
  const shapeClips = state.clips.filter(c => c.type === 'shape');
  const captionClips = state.clips.filter(c => c.type === 'caption');

  // Video/Image layers
  if (visualClips.length > 0) {
    const layer = new core.Layer();
    await comp.add(layer);

    for (const clip of visualClips) {
      try {
        const dur = clip.speed !== 1 ? `${clip.duration / clip.speed}s` : `${clip.duration}s`;
        const opts: any = {
          delay: `${clip.startTime}s`,
          duration: dur,
        };
        if (clip.effects.length > 0) opts.effects = clip.effects;
        if (clip.transition) opts.transition = clip.transition;
        if (clip.volume !== undefined) opts.volume = clip.volume;
        if (clip.muted) opts.muted = true;

        if (clip.type === 'video') {
          const vc = new core.VideoClip(clip.source, opts);
          await layer.add(vc);
        } else {
          const ic = new core.ImageClip(clip.source, opts);
          await layer.add(ic);
        }
      } catch (e) {
        console.error('Visual clip error:', clip.name, e);
      }
    }
  }

  // Text layers
  for (const clip of textClips) {
    try {
      const layer = new core.Layer();
      await comp.add(layer);
      const opts: any = {
        text: clip.text || '',
        fontSize: clip.fontSize || 48,
        color: (clip.fontColor || '#ffffff'),
        x: `${clip.x || 50}%`,
        y: `${clip.y || 50}%`,
        align: 'center',
        baseline: 'middle',
        delay: `${clip.startTime}s`,
        duration: `${clip.duration}s`,
      };
      if (clip.strokeWidth && clip.strokeWidth > 0) {
        opts.strokes = [{ width: clip.strokeWidth, color: clip.strokeColor || '#000000' }];
      }
      if (clip.effects.length > 0) opts.effects = clip.effects;
      if (clip.transition) opts.transition = clip.transition;
      await layer.add(new core.TextClip(opts));
    } catch (e) { console.error('Text clip error:', e); }
  }

  // Shape layers
  for (const clip of shapeClips) {
    try {
      const layer = new core.Layer();
      await comp.add(layer);
      const opts: any = {
        fill: (clip.fillColor || '#5b4ed4'),
        width: clip.shapeWidth || 200,
        height: clip.shapeHeight || 200,
        x: `${clip.x || 50}%`,
        y: `${clip.y || 50}%`,
        delay: `${clip.startTime}s`,
        duration: `${clip.duration}s`,
      };
      if (clip.effects.length > 0) opts.effects = clip.effects;

      if (clip.shapeType === 'ellipse') {
        await layer.add(new core.EllipseClip(opts));
      } else if (clip.shapeType === 'polygon') {
        opts.sides = clip.sides || 6;
        await layer.add(new core.PolygonClip(opts));
      } else {
        await layer.add(new core.RectangleClip(opts));
      }
    } catch (e) { console.error('Shape clip error:', e); }
  }

  // Caption layers — word-by-word text clips
  for (const clip of captionClips) {
    try {
      if (!clip.captionWords || clip.captionWords.length === 0) continue;
      const words = clip.captionWords;
      const wordDuration = clip.duration / words.length;

      for (let i = 0; i < words.length; i++) {
        const layer = new core.Layer();
        await comp.add(layer);
        await layer.add(new core.TextClip({
          text: words[i],
          fontSize: clip.fontSize || 48,
          color: (clip.fontColor || '#ffffff') as `#${string}`,
          x: `${clip.x || 50}%`,
          y: `${clip.y || 85}%`,
          align: 'center',
          baseline: 'middle',
          delay: clip.startTime + i * wordDuration,
          duration: wordDuration,
          strokes: [{ width: 2, color: '#000000' }],
        }));
      }
    } catch (e) { console.error('Caption clip error:', e); }
  }

  // Audio layers
  if (audioClips.length > 0) {
    const layer = new core.Layer();
    await comp.add(layer);
    for (const clip of audioClips) {
      try {
        const opts: any = {
          delay: `${clip.startTime}s`,
          duration: `${clip.duration}s`,
        };
        if (clip.volume !== undefined) opts.volume = clip.volume;
        if (clip.muted) opts.muted = true;
        await layer.add(new core.AudioClip(clip.source, opts));
      } catch (e) { console.error('Audio clip error:', e); }
    }
  }

  return comp;
}

// === Player ===
async function refreshPlayer() {
  if (!playerEl || isRebuilding) return;
  isRebuilding = true;

  try {
    // Stop old
    if (composition) {
      try { composition.pause(); } catch (e) {}
      composition.unmount();
      playerEl.innerHTML = '';
      composition = null;
    }

    // Build new
    composition = await buildComposition();
    if (!composition) { isRebuilding = false; return; }

    // Mount
    composition.mount(playerEl);

    // Resize
    const container = document.getElementById('player-container');
    if (container) {
      if (resizeObserver) resizeObserver.disconnect();
      const handleResize = () => {
        if (!composition || !container || !playerEl) return;
        try {
          const w = composition.width || 1920;
          const h = composition.height || 1080;
          const scale = Math.min(
            (container.clientWidth - 20) / w,
            (container.clientHeight - 20) / h,
            1
          );
          playerEl!.style.width = w + 'px';
          playerEl!.style.height = h + 'px';
          playerEl!.style.transform = `scale(${scale})`;
          playerEl!.style.transformOrigin = 'center';
        } catch (e) {}
      };
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(container);
      handleResize();
    }

    // Seek to start
    await composition.seek(0);
    updateTimeDisplay();
    setupCompositionEvents();
  } catch (e) {
    console.error('Player build failed:', e);
  }
  isRebuilding = false;
}

function setupCompositionEvents() {
  if (!composition) return;
  composition.on('playback:time', () => {
    updateTimeDisplay();
    if (composition) updateCursor(composition.currentTime);
  });
  composition.on('playback:end', () => showPlayState(false));
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
    el.textContent = `00:00.000 / ${formatTime(state.totalDuration)}`;
  }
}

function updateCursor(time: number) {
  const cursor = document.getElementById('timeline-cursor');
  if (!cursor) return;
  cursor.style.left = (time * 60 * state.zoom) + 'px';
}

// === File Handling ===
async function handleFiles(files: FileList | File[]) {
  const fileArray = Array.from(files);

  for (const file of fileArray) {
    const mediaType = getMediaType(file);
    if (!mediaType) continue;

    const url = URL.createObjectURL(file);
    const clip: ClipData = {
      id: nextId(),
      type: mediaType,
      name: file.name.length > 25 ? file.name.substring(0, 22) + '...' : file.name,
      file, url,
      startTime: findNextSlot(),
      duration: 5,
      trimStart: 0, trimEnd: 0,
      speed: 1,
      layerIndex: 0,
      volume: 1,
      muted: false,
      effects: [],
    };

    // Load source
    try {
      clip.source = await loadSource(url, mediaType);
    } catch (e) {
      console.error('Source load failed:', file.name, e);
    }

    // Get actual duration
    if (mediaType === 'video' || mediaType === 'audio') {
      try {
        const tempMedia = document.createElement(mediaType === 'video' ? 'video' : 'audio');
        tempMedia.preload = 'metadata';
        tempMedia.src = url;
        await new Promise<void>((resolve) => {
          tempMedia.onloadedmetadata = () => {
            clip.duration = Math.max(0.5, tempMedia.duration || 5);
            resolve();
          };
          tempMedia.onerror = () => resolve();
          setTimeout(() => resolve(), 5000);
        });
      } catch (e) {}
    } else if (mediaType === 'image') {
      clip.duration = 5; // images default to 5s
    }

    addClip(clip);
  }

  // Update UI
  renderMediaBin();
  renderProperties();
  renderEffects();
  renderTransitions();
  renderTimeline();

  // Rebuild player
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

// === Controls ===
function setupControls() {
  document.getElementById('btn-play')?.addEventListener('click', async () => {
    if (!composition) {
      await refreshPlayer();
    }
    if (composition) {
      try {
        await composition.play();
        showPlayState(true);
      } catch (e) {
        console.error('Play error:', e);
        await refreshPlayer();
        if (composition) {
          try { await composition.play(); showPlayState(true); } catch (e2) {}
        }
      }
    }
  });

  document.getElementById('btn-pause')?.addEventListener('click', async () => {
    if (composition) {
      try { await composition.pause(); showPlayState(false); } catch (e) {}
    }
  });

  document.getElementById('btn-back')?.addEventListener('click', async () => {
    if (composition) {
      try {
        await composition.seek(0);
        updateTimeDisplay();
        updateCursor(0);
      } catch (e) {}
    }
  });

  document.getElementById('btn-forward')?.addEventListener('click', async () => {
    if (composition) {
      try {
        const d = composition.duration || state.totalDuration;
        await composition.seek(d);
        updateTimeDisplay();
        updateCursor(d);
      } catch (e) {}
    }
  });

  // Timeline seek
  const scroll = document.getElementById('timeline-scroll');
  scroll?.addEventListener('click', async (e) => {
    if (!scroll) return;
    const rect = scroll.getBoundingClientRect();
    const pos = (e.clientX - rect.left + scroll.scrollLeft) / (60 * state.zoom);
    const t = Math.max(0, pos);
    if (composition) {
      try {
        await composition.seek(t);
        updateTimeDisplay();
      } catch (e) {}
    }
    updateCursor(t);
  });

  setPlayheadGetter(() => composition ? composition.currentTime : 0);
}

// === Keyboard Shortcuts ===
function setupKeyboard() {
  document.addEventListener('keydown', async (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); renderAll(); }
    else if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); renderAll(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedId !== null) { removeClip(state.selectedId); renderAll(); }
    }
    else if (e.key === ' ') {
      e.preventDefault();
      if (state.isPlaying) {
        if (composition) { try { await composition.pause(); showPlayState(false); } catch (e) {} }
      } else {
        document.getElementById('btn-play')?.click();
      }
    }
    else if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      doSave();
    }
  });
}

function renderAll() {
  renderMediaBin();
  renderProperties();
  renderEffects();
  renderTransitions();
  renderTimeline();
}

// === Zoom ===
function setupZoom() {
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => { state.zoom = Math.min(4, state.zoom + 0.25); renderTimeline(); });
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => { state.zoom = Math.max(0.25, state.zoom - 0.25); renderTimeline(); });
}

// === Text Modal ===
function setupTextModal() {
  const modal = document.getElementById('text-modal');
  document.getElementById('btn-add-text')?.addEventListener('click', () => {
    modal!.style.display = '';
    (document.getElementById('text-input') as HTMLInputElement).value = '';
    (document.getElementById('text-input') as HTMLInputElement).focus();
  });
  document.getElementById('text-cancel')?.addEventListener('click', () => { modal!.style.display = 'none'; });
  document.getElementById('text-confirm')?.addEventListener('click', async () => {
    const text = (document.getElementById('text-input') as HTMLInputElement).value.trim();
    if (!text) return;
    const clip: ClipData = {
      id: nextId(), type: 'text', name: text.length > 20 ? text.substring(0, 17) + '...' : text, text,
      fontSize: parseFloat((document.getElementById('text-size') as HTMLInputElement).value) || 48,
      fontColor: (document.getElementById('text-color') as HTMLInputElement).value || '#ffffff',
      x: parseFloat((document.getElementById('text-x') as HTMLInputElement).value) || 50,
      y: parseFloat((document.getElementById('text-y') as HTMLInputElement).value) || 50,
      strokeWidth: parseFloat((document.getElementById('text-stroke') as HTMLInputElement).value) || 0,
      startTime: findNextSlot(),
      duration: parseFloat((document.getElementById('text-duration') as HTMLInputElement).value) || 3,
      trimStart: 0, trimEnd: 0, speed: 1, layerIndex: 1, effects: [],
    };
    addClip(clip);
    renderAll();
    modal!.style.display = 'none';
    await refreshPlayer();
  });
}

// === Shape Modal ===
function setupShapeModal() {
  const modal = document.getElementById('shape-modal');
  document.getElementById('btn-add-shape')?.addEventListener('click', () => { modal!.style.display = ''; });
  document.getElementById('shape-cancel')?.addEventListener('click', () => { modal!.style.display = 'none'; });
  document.getElementById('shape-confirm')?.addEventListener('click', async () => {
    const shapeType = (document.getElementById('shape-type') as HTMLSelectElement).value;
    const clip: ClipData = {
      id: nextId(), type: 'shape', name: shapeType.charAt(0).toUpperCase() + shapeType.slice(1),
      shapeType,
      fillColor: (document.getElementById('shape-fill') as HTMLInputElement).value || '#5b4ed4',
      shapeWidth: parseFloat((document.getElementById('shape-width') as HTMLInputElement).value) || 200,
      shapeHeight: parseFloat((document.getElementById('shape-height') as HTMLInputElement).value) || 200,
      x: parseFloat((document.getElementById('shape-x') as HTMLInputElement).value) || 50,
      y: parseFloat((document.getElementById('shape-y') as HTMLInputElement).value) || 50,
      sides: parseFloat((document.getElementById('shape-sides') as HTMLInputElement).value) || 6,
      startTime: findNextSlot(),
      duration: parseFloat((document.getElementById('shape-duration') as HTMLInputElement).value) || 3,
      trimStart: 0, trimEnd: 0, speed: 1, layerIndex: 1, effects: [],
    };
    addClip(clip);
    renderAll();
    modal!.style.display = 'none';
    await refreshPlayer();
  });
}

// === Caption Modal ===
function setupCaptionModal() {
  const modal = document.getElementById('caption-modal');
  document.getElementById('btn-add-caption')?.addEventListener('click', () => {
    modal!.style.display = '';
    (document.getElementById('caption-text') as HTMLInputElement).value = '';
  });
  document.getElementById('caption-cancel')?.addEventListener('click', () => { modal!.style.display = 'none'; });
  document.getElementById('caption-confirm')?.addEventListener('click', async () => {
    const text = (document.getElementById('caption-text') as HTMLInputElement).value.trim();
    if (!text) return;
    const words = text.split(/\s+/);
    const clip: ClipData = {
      id: nextId(), type: 'caption', name: 'Captions',
      text, captionWords: words,
      captionPreset: (document.getElementById('caption-preset') as HTMLSelectElement).value,
      fontSize: parseFloat((document.getElementById('caption-size') as HTMLInputElement).value) || 48,
      y: parseFloat((document.getElementById('caption-y') as HTMLInputElement).value) || 85,
      fontColor: '#ffffff',
      startTime: parseFloat((document.getElementById('caption-start') as HTMLInputElement).value) || 0,
      duration: words.length * 0.5,
      trimStart: 0, trimEnd: 0, speed: 1, layerIndex: 1, effects: [],
    };
    addClip(clip);
    renderAll();
    modal!.style.display = 'none';
    await refreshPlayer();
  });
}

// === Export ===
function setupExport() {
  document.getElementById('btn-export')?.addEventListener('click', () => {
    if (state.clips.length === 0) { alert('Add some media first!'); return; }
    document.getElementById('export-modal')!.style.display = '';
  });
  document.getElementById('export-cancel')?.addEventListener('click', () => { document.getElementById('export-modal')!.style.display = 'none'; });
  document.getElementById('export-confirm')?.addEventListener('click', async () => {
    document.getElementById('export-modal')!.style.display = 'none';
    await doExport();
  });
}

async function doExport() {
  const overlay = document.getElementById('progress-overlay');
  const progressText = document.getElementById('progress-text');
  const progressFill = document.getElementById('progress-fill');
  if (!overlay) return;

  try {
    const exportComp = await buildComposition();
    if (!exportComp) { alert('Nothing to export!'); return; }
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
  } finally { overlay.style.display = 'none'; }
}

// === Undo/Redo ===
function setupUndoRedo() {
  document.getElementById('btn-undo')?.addEventListener('click', () => { undo(); renderAll(); });
  document.getElementById('btn-redo')?.addEventListener('click', () => { redo(); renderAll(); });
}

// === Timeline Toolbar ===
function setupTimelineToolbar() {
  document.getElementById('btn-split')?.addEventListener('click', async () => {
    if (state.selectedId === null) { alert('Select a clip first!'); return; }
    splitClipAtPlayhead(composition ? composition.currentTime : 0);
    renderAll();
    await refreshPlayer();
  });

  document.getElementById('btn-delete-clip')?.addEventListener('click', () => {
    if (state.selectedId !== null) { removeClip(state.selectedId); renderAll(); }
  });

  document.getElementById('speed-select')?.addEventListener('change', async (e) => {
    const clip = getSelectedClip();
    if (clip) {
      clip.speed = parseFloat((e.target as HTMLSelectElement).value) || 1;
      renderAll();
      await refreshPlayer();
    }
  });

  const volSlider = document.getElementById('volume-slider') as HTMLInputElement;
  const volValue = document.getElementById('volume-value');
  volSlider?.addEventListener('input', () => {
    const val = parseInt(volSlider.value);
    if (volValue) volValue.textContent = val + '%';
    const clip = getSelectedClip();
    if (clip) { clip.volume = val / 100; }
  });
}

// === Screenshot ===
function setupScreenshot() {
  document.getElementById('btn-screenshot')?.addEventListener('click', () => {
    if (!composition) return;
    try {
      const dataUrl = composition.screenshot();
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'screenshot.png';
      a.click();
    } catch (e) { console.error('Screenshot failed:', e); }
  });
}

// === Save / Load ===
function setupSaveLoad() {
  document.getElementById('btn-save')?.addEventListener('click', doSave);
  document.getElementById('btn-load')?.addEventListener('click', () => {
    document.getElementById('loadInput')?.click();
  });
  document.getElementById('loadInput')?.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const text = await file.text();
    loadProject(text);
    renderAll();
    await refreshPlayer();
    (e.target as HTMLInputElement).value = '';
  });
}

function doSave() {
  const json = saveProject();
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'project.json';
  a.click();
}

// === Lock Screen ===
function setupLockScreen() {
  const lockScreen = document.getElementById('lock-screen');
  const uploadScreen = document.getElementById('upload-screen');
  const passwordInput = document.getElementById('lock-password') as HTMLInputElement;
  const submitBtn = document.getElementById('lock-submit');
  const errorMsg = document.getElementById('lock-error');

  function unlock() {
    const password = passwordInput.value.trim();
    if (password === 'zainale') {
      lockScreen!.style.display = 'none';
      uploadScreen!.style.display = '';
      setupUploadScreen();
    } else {
      errorMsg!.style.display = '';
      passwordInput.value = '';
      passwordInput.focus();
      passwordInput.classList.add('shake');
      setTimeout(() => passwordInput.classList.remove('shake'), 400);
    }
  }

  submitBtn?.addEventListener('click', unlock);
  passwordInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') unlock();
  });
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

// === Media Add ===
function setupMediaAdd() {
  const btn = document.getElementById('btn-add-media');
  const input = document.getElementById('mediaInput') as HTMLInputElement;
  btn?.addEventListener('click', () => input.click());
  input?.addEventListener('change', async () => {
    if (input.files?.length) { await handleFiles(input.files); input.value = ''; }
  });
}

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
  setupLockScreen();
  setupTabs();

  const observer = new MutationObserver(() => {
    const editor = document.getElementById('editor-screen');
    if (editor && editor.style.display !== 'none') {
      observer.disconnect();
      playerEl = document.getElementById('player') as HTMLDivElement;
      renderMediaBin();
      renderTimeline();
      renderEffects();
      renderTransitions();
      setupControls();
      setupKeyboard();
      setupZoom();
      setupTextModal();
      setupShapeModal();
      setupCaptionModal();
      setupExport();
      setupUndoRedo();
      setupTimelineToolbar();
      setupScreenshot();
      setupSaveLoad();
      setupMediaAdd();
    }
  });
  observer.observe(document.body, { subtree: true, attributes: true });
});

if (!('showSaveFilePicker' in window)) {
  Object.assign(window, { showSaveFilePicker: async () => 'edited_video.mp4' });
}

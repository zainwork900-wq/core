// ============================================================
// EDITOR STATE & RENDERING — Full Video Editor
// ============================================================

// === Types ===
export type MediaType = 'video' | 'audio' | 'image' | 'text' | 'shape' | 'caption';

export interface ClipData {
  id: number;
  type: MediaType;
  name: string;
  file?: File;
  url?: string;
  source?: any;

  // Timing
  startTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
  speed: number;
  layerIndex: number;

  // Text
  text?: string;
  fontSize?: number;
  fontColor?: string;
  x?: number;
  y?: number;
  strokeWidth?: number;
  strokeColor?: string;

  // Shape
  shapeType?: string;
  fillColor?: string;
  shapeWidth?: number;
  shapeHeight?: number;
  sides?: number;

  // Audio
  volume?: number;
  muted?: boolean;

  // Effects
  effects: any[];
  selectedEffect?: string;
  effectValue?: number;

  // Transition
  transition?: any;

  // Caption
  captionPreset?: string;
  captionWords?: string[];
}

export interface EditorState {
  clips: ClipData[];
  selectedId: number | null;
  zoom: number;
  totalDuration: number;
  isPlaying: boolean;
  undoStack: string[];
  redoStack: string[];
}

let _nextId = 1;
export function nextId(): number { return _nextId++; }

export const state: EditorState = {
  clips: [],
  selectedId: null,
  zoom: 1,
  totalDuration: 10,
  isPlaying: false,
  undoStack: [],
  redoStack: [],
};

// === Undo/Redo ===
export function saveState(): void {
  const snapshot = JSON.stringify(state.clips.map(c => ({
    ...c,
    file: undefined,
    url: c.url,
    source: undefined,
  })));
  state.undoStack.push(snapshot);
  if (state.undoStack.length > 50) state.undoStack.shift();
  state.redoStack = [];
}

export function undo(): ClipData[] | null {
  if (state.undoStack.length === 0) return null;
  const current = JSON.stringify(state.clips.map(c => ({
    ...c, file: undefined, source: undefined,
  })));
  state.redoStack.push(current);
  const prev = JSON.parse(state.undoStack.pop()!);
  state.clips = prev;
  recalcDuration();
  return state.clips;
}

export function redo(): ClipData[] | null {
  if (state.redoStack.length === 0) return null;
  const current = JSON.stringify(state.clips.map(c => ({
    ...c, file: undefined, source: undefined,
  })));
  state.undoStack.push(current);
  const next = JSON.parse(state.redoStack.pop()!);
  state.clips = next;
  recalcDuration();
  return state.clips;
}

// === CRUD ===
export function addClip(clip: ClipData): void {
  saveState();
  state.clips.push(clip);
  recalcDuration();
}

export function removeClip(id: number): void {
  saveState();
  state.clips = state.clips.filter(c => c.id !== id);
  if (state.selectedId === id) state.selectedId = null;
  recalcDuration();
}

export function selectClip(id: number | null): void {
  state.selectedId = id;
}

export function getSelectedClip(): ClipData | null {
  if (state.selectedId === null) return null;
  return state.clips.find(c => c.id === state.selectedId) || null;
}

export function updateClip(id: number, updates: Partial<ClipData>): void {
  saveState();
  const clip = state.clips.find(c => c.id === id);
  if (clip) Object.assign(clip, updates);
  recalcDuration();
}

// === Split ===
export function splitClipAtPlayhead(playheadTime: number): void {
  const clip = getSelectedClip();
  if (!clip) return;
  if (clip.type === 'text' || clip.type === 'shape' || clip.type === 'caption') return;

  const relTime = playheadTime - clip.startTime;
  if (relTime <= 0 || relTime >= clip.duration) return;

  saveState();

  const newClip: ClipData = {
    ...clip,
    id: nextId(),
    startTime: clip.startTime + relTime,
    duration: clip.duration - relTime,
    trimStart: clip.trimStart + relTime * clip.speed,
    name: clip.name + ' (split)',
  };

  clip.duration = relTime;
  clip.trimEnd = clip.trimEnd + (clip.duration - relTime) * clip.speed;

  state.clips.push(newClip);
  recalcDuration();
}

// === Duplicate ===
export function duplicateClip(id: number): void {
  const clip = state.clips.find(c => c.id === id);
  if (!clip) return;
  saveState();
  const dup: ClipData = {
    ...clip,
    id: nextId(),
    startTime: clip.startTime + clip.duration + 0.1,
    name: clip.name + ' (copy)',
    file: clip.file,
    url: clip.url,
    source: clip.source,
    effects: [...clip.effects],
  };
  state.clips.push(dup);
  recalcDuration();
}

// === Sorting ===
export function bringToFront(id: number): void {
  const idx = state.clips.findIndex(c => c.id === id);
  if (idx < 0) return;
  saveState();
  const [clip] = state.clips.splice(idx, 1);
  state.clips.push(clip);
}

export function sendToBack(id: number): void {
  const idx = state.clips.findIndex(c => c.id === id);
  if (idx < 0) return;
  saveState();
  const [clip] = state.clips.splice(idx, 1);
  state.clips.unshift(clip);
}

// === Duration ===
function recalcDuration(): void {
  let max = 5;
  for (const c of state.clips) {
    const end = c.startTime + c.duration;
    if (end > max) max = end;
  }
  state.totalDuration = max + 1;
}

// === Helpers ===
export function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '00:00.000';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${s < 10 ? '0' : ''}${s.toFixed(3).slice(1)}`;
}

export function getMediaType(file: File): MediaType | null {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  return null;
}

// === Tab Switching ===
export function setupTabs(): void {
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.getAttribute('data-tab')!;
      const panels: Record<string, string> = {
        media: 'panel-media',
        properties: 'panel-properties',
        effects: 'panel-effects',
        transitions: 'panel-transitions',
      };
      document.querySelectorAll('#left-panel > .panel-section').forEach(p => {
        if (p.id && p.id.startsWith('panel-')) p.classList.add('hidden');
      });
      const target = document.getElementById(panels[name]);
      if (target) target.classList.remove('hidden');
    });
  });
}

// === Render Media Bin ===
export function renderMediaBin(): void {
  const bin = document.getElementById('media-bin');
  if (!bin) return;
  bin.innerHTML = '';

  if (state.clips.length === 0) {
    bin.innerHTML = '<div style="text-align:center;color:var(--txt3);padding:20px;font-size:11px">No media yet.<br>Click + or drag files.</div>';
    return;
  }

  for (const clip of state.clips) {
    const item = document.createElement('div');
    item.className = 'media-item' + (clip.id === state.selectedId ? ' selected' : '');
    item.dataset.id = String(clip.id);

    const icons: Record<string, string> = {
      video: '🎬', audio: '🎵', image: '🖼️', text: '📝', shape: '🔷', caption: '💬',
    };
    const meta = clip.type === 'text' || clip.type === 'shape' || clip.type === 'caption'
      ? clip.name
      : `${clip.duration.toFixed(1)}s · ${clip.type}`;

    item.innerHTML = `
      <div class="media-thumb">${icons[clip.type] || '📄'}</div>
      <div class="media-info">
        <div class="media-name">${clip.name}</div>
        <div class="media-meta">${meta}</div>
      </div>
      <button class="media-delete" data-id="${clip.id}" title="Delete">×</button>
    `;

    item.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('media-delete')) return;
      selectClip(clip.id);
      renderMediaBin();
      renderProperties();
      renderEffects();
      renderTransitions();
    });

    item.querySelector('.media-delete')?.addEventListener('click', (e) => {
      e.stopPropagation();
      removeClip(clip.id);
      renderMediaBin();
      renderProperties();
      renderEffects();
      renderTransitions();
    });

    bin.appendChild(item);
  }
}

// === Render Properties ===
export function renderProperties(): void {
  const panel = document.getElementById('panel-properties');
  if (!panel) return;
  const clip = getSelectedClip();
  if (!clip) {
    panel.innerHTML = '<div style="text-align:center;color:var(--txt3);padding:20px;font-size:11px">Select a clip to edit properties</div>';
    return;
  }

  let html = '';

  // Common
  html += `<div class="prop-group"><div class="prop-group-title">Timing</div>`;
  html += propRow('Start', 'number', 'prop-start', clip.startTime.toFixed(2), 's', '0', '600', '0.1');
  html += propRow('Duration', 'number', 'prop-duration', clip.duration.toFixed(2), 's', '0.1', '600', '0.1');
  html += propRow('Speed', 'number', 'prop-speed', clip.speed, 'x', '0.25', '4', '0.25');
  html += `</div>`;

  // Type-specific
  if (clip.type === 'text' || clip.type === 'caption') {
    html += `<div class="prop-group"><div class="prop-group-title">Text</div>`;
    html += `<div class="prop-row"><label>Text</label><input type="text" id="prop-text" value="${escHtml(clip.text || '')}" style="width:100%"/></div>`;
    html += propRow('Size', 'number', 'prop-fontSize', clip.fontSize || 48, 'px', '8', '200', '1');
    html += `<div class="prop-row"><label>Color</label><input type="color" id="prop-fontColor" value="${clip.fontColor || '#ffffff'}"/></div>`;
    html += propRow('X', 'number', 'prop-x', clip.x || 50, '%', '0', '100', '1');
    html += propRow('Y', 'number', 'prop-y', clip.y || 50, '%', '0', '100', '1');
    if (clip.type === 'text') {
      html += propRow('Stroke', 'number', 'prop-strokeWidth', clip.strokeWidth || 0, 'px', '0', '10', '1');
    }
    html += `</div>`;
  }

  if (clip.type === 'shape') {
    html += `<div class="prop-group"><div class="prop-group-title">Shape</div>`;
    html += `<div class="prop-row"><label>Fill</label><input type="color" id="prop-fillColor" value="${clip.fillColor || '#5b4ed4'}"/></div>`;
    html += propRow('Width', 'number', 'prop-shapeWidth', clip.shapeWidth || 200, 'px', '10', '1920', '1');
    html += propRow('Height', 'number', 'prop-shapeHeight', clip.shapeHeight || 200, 'px', '10', '1080', '1');
    html += propRow('X', 'number', 'prop-x', clip.x || 50, '%', '0', '100', '1');
    html += propRow('Y', 'number', 'prop-y', clip.y || 50, '%', '0', '100', '1');
    if (clip.shapeType === 'polygon') {
      html += propRow('Sides', 'number', 'prop-sides', clip.sides || 6, '', '3', '20', '1');
    }
    html += `</div>`;
  }

  if (clip.type === 'video' || clip.type === 'audio') {
    html += `<div class="prop-group"><div class="prop-group-title">Audio</div>`;
    html += propRow('Volume', 'range', 'prop-volume', (clip.volume ?? 1) * 100, '%', '0', '200', '1');
    html += `<div class="prop-row"><label>Muted</label><input type="checkbox" id="prop-muted" ${clip.muted ? 'checked' : ''} class="prop-checkbox" style="width:auto"/></div>`;
    html += `</div>`;
  }

  // Effects summary
  if (clip.effects.length > 0) {
    html += `<div class="prop-group"><div class="prop-group-title">Active Effects</div>`;
    for (const fx of clip.effects) {
      html += `<div class="prop-row"><label>${fx.type}</label><span class="prop-value">${fx.value}</span></div>`;
    }
    html += `<button class="btn btn-sm btn-red" id="btn-clear-effects" style="width:100%;margin-top:4px">Clear All Effects</button>`;
    html += `</div>`;
  }

  panel.innerHTML = html;
  bindPropEvents(clip);
}

function propRow(label: string, type: string, id: string, value: any, unit: string, min: string, max: string, step: string): string {
  if (type === 'range') {
    return `<div class="prop-row"><label>${label}</label><input type="range" id="${id}" value="${value}" min="${min}" max="${max}" step="${step}" style="accent-color:var(--acc)"/><span class="prop-value">${value}${unit}</span></div>`;
  }
  return `<div class="prop-row"><label>${label}</label><input type="${type}" id="${id}" value="${value}" min="${min}" max="${max}" step="${step}"/><span class="prop-value">${unit}</span></div>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function bindPropEvents(clip: ClipData): void {
  const bind = (id: string, key: keyof ClipData, transform?: (v: any) => any) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      let val: any = (el as HTMLInputElement).value;
      if (el.getAttribute('type') === 'number' || el.getAttribute('type') === 'range') val = parseFloat(val);
      if (transform) val = transform(val);
      (clip as any)[key] = val;
      renderMediaBin();
    });
  };

  bind('prop-start', 'startTime');
  bind('prop-duration', 'duration');
  bind('prop-speed', 'speed');
  bind('prop-fontSize', 'fontSize');
  bind('prop-fontColor', 'fontColor');
  bind('prop-x', 'x');
  bind('prop-y', 'y');
  bind('prop-strokeWidth', 'strokeWidth');
  bind('prop-fillColor', 'fillColor');
  bind('prop-shapeWidth', 'shapeWidth');
  bind('prop-shapeHeight', 'shapeHeight');
  bind('prop-sides', 'sides');
  bind('prop-volume', 'volume', (v: number) => v / 100);

  const textEl = document.getElementById('prop-text') as HTMLInputElement;
  if (textEl) {
    textEl.addEventListener('input', () => {
      clip.text = textEl.value;
      clip.name = textEl.value.substring(0, 20) || 'Text';
      renderMediaBin();
    });
  }

  const mutedEl = document.getElementById('prop-muted') as HTMLInputElement;
  if (mutedEl) {
    mutedEl.addEventListener('change', () => {
      clip.muted = mutedEl.checked;
    });
  }

  const clearFx = document.getElementById('btn-clear-effects');
  if (clearFx) {
    clearFx.addEventListener('click', () => {
      clip.effects = [];
      renderProperties();
      renderEffects();
    });
  }
}

// === Effects Panel ===
const EFFECTS = [
  { id: 'blur', name: 'Blur', icon: '🌫️', min: 0, max: 20, step: 0.5, def: 0 },
  { id: 'brightness', name: 'Brightness', icon: '☀️', min: 0, max: 300, step: 5, def: 100 },
  { id: 'contrast', name: 'Contrast', icon: '◐', min: 0, max: 300, step: 5, def: 100 },
  { id: 'grayscale', name: 'Grayscale', icon: '⬛', min: 0, max: 100, step: 5, def: 0 },
  { id: 'saturate', name: 'Saturate', icon: '🎨', min: 0, max: 300, step: 5, def: 100 },
  { id: 'sepia', name: 'Sepia', icon: '📜', min: 0, max: 100, step: 5, def: 0 },
  { id: 'invert', name: 'Invert', icon: '🔄', min: 0, max: 100, step: 5, def: 0 },
  { id: 'hue-rotate', name: 'Hue Rotate', icon: '🌈', min: 0, max: 360, step: 5, def: 0 },
  { id: 'opacity', name: 'Opacity', icon: '👁️', min: 0, max: 100, step: 5, def: 100 },
  { id: 'drop-shadow', name: 'Drop Shadow', icon: '🔹', min: 0, max: 30, step: 1, def: 0 },
];

export function renderEffects(): void {
  const grid = document.getElementById('effects-grid');
  if (!grid) return;
  grid.innerHTML = '';

  for (const fx of EFFECTS) {
    const active = clipHasEffect(fx.id);
    const card = document.createElement('div');
    card.className = 'effect-card' + (active ? ' active' : '');
    card.innerHTML = `<div class="icon">${fx.icon}</div><div class="name">${fx.name}</div>`;
    card.addEventListener('click', () => toggleEffect(fx));
    grid.appendChild(card);
  }
}

function clipHasEffect(type: string): boolean {
  const clip = getSelectedClip();
  if (!clip) return false;
  return clip.effects.some(e => e.type === type);
}

function toggleEffect(fx: typeof EFFECTS[0]): void {
  const clip = getSelectedClip();
  if (!clip) return;
  saveState();

  const idx = clip.effects.findIndex(e => e.type === fx.id);
  if (idx >= 0) {
    clip.effects.splice(idx, 1);
  } else {
    if (fx.id === 'drop-shadow') {
      clip.effects.push({ type: fx.id, value: { offsetX: 4, offsetY: 4, blur: 4, color: 'rgba(0,0,0,0.5)' } });
    } else {
      clip.effects.push({ type: fx.id, value: fx.def });
    }
  }
  renderEffects();
  renderProperties();
}

// === Transitions Panel ===
const TRANSITIONS = [
  { id: 'dissolve', name: 'Dissolve' },
  { id: 'slide-from-right', name: 'Slide Right' },
  { id: 'slide-from-left', name: 'Slide Left' },
  { id: 'fade-to-black', name: 'Fade Black' },
  { id: 'fade-to-white', name: 'Fade White' },
];

export function renderTransitions(): void {
  const list = document.getElementById('transitions-list');
  if (!list) return;
  const clip = getSelectedClip();
  list.innerHTML = '';

  for (const tr of TRANSITIONS) {
    const active = clip?.transition?.type === tr.id;
    const item = document.createElement('div');
    item.className = 'transition-item' + (active ? ' active' : '');
    item.innerHTML = `<div class="transition-preview"></div><span>${tr.name}</span>`;
    item.addEventListener('click', () => {
      if (!clip) return;
      saveState();
      if (active) {
        clip.transition = undefined;
      } else {
        clip.transition = { type: tr.id, duration: '0.5s' };
      }
      renderTransitions();
    });
    list.appendChild(item);
  }
}

// === Timeline Rendering ===
export function renderTimeline(): void {
  const zoomLabel = document.getElementById('zoom-level');
  if (zoomLabel) zoomLabel.textContent = state.zoom.toFixed(1) + 'x';

  renderTrackClips('track-video', 'video');
  renderTrackClips('track-text', 'text');
  renderTrackClips('track-audio', 'audio');
  renderTrackClips('track-shape', 'shape');
  renderRuler();
}

function renderTrackClips(trackId: string, type: string): void {
  const track = document.getElementById(trackId);
  if (!track) return;

  // Remove old clips
  track.querySelectorAll('.tclip').forEach(el => el.remove());

  // Empty hint
  const clips = state.clips.filter(c => {
    if (type === 'video') return c.type === 'video' || c.type === 'image';
    return c.type === type;
  });

  if (clips.length === 0) {
    if (!track.querySelector('.track-hint')) {
      const hint = document.createElement('div');
      hint.className = 'track-hint';
      hint.textContent = type === 'video' ? 'Drop video/image here' : type === 'text' ? 'Click Text to add' : type === 'audio' ? 'Drop audio here' : 'Click Shape to add';
      track.appendChild(hint);
    }
    return;
  }

  track.querySelector('.track-hint')?.remove();

  for (const clip of clips) {
    const el = document.createElement('div');
    el.className = `tclip ${clip.type}` + (clip.id === state.selectedId ? ' selected' : '');
    el.dataset.id = String(clip.id);
    el.style.left = (clip.startTime * 60 * state.zoom) + 'px';
    el.style.width = Math.max(20, clip.duration * 60 * state.zoom) + 'px';

    el.innerHTML = `
      <div class="trim-handle trim-left" data-trim="left"></div>
      <span class="clip-name">${clip.name}</span>
      <button class="clip-delete" data-id="${clip.id}" title="Delete">×</button>
      <div class="trim-handle trim-right" data-trim="right"></div>
    `;

    // Click select
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('clip-delete')) return;
      selectClip(clip.id);
      renderMediaBin();
      renderProperties();
      renderEffects();
      renderTransitions();
      renderTimeline();
    });

    // Delete
    el.querySelector('.clip-delete')?.addEventListener('click', (e) => {
      e.stopPropagation();
      removeClip(clip.id);
      renderMediaBin();
      renderProperties();
      renderEffects();
      renderTransitions();
      renderTimeline();
    });

    // Context menu
    el.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      selectClip(clip.id);
      showContextMenu(e.clientX, e.clientY, clip.id);
      renderTimeline();
    });

    // Drag move
    setupClipDrag(el, clip);

    // Trim handles
    setupTrimHandles(el, clip);

    track.appendChild(el);
  }
}

function renderRuler(): void {
  const ruler = document.getElementById('timeline-ruler');
  if (!ruler) return;
  ruler.innerHTML = '';

  const pxPerSec = 60 * state.zoom;
  const step = state.zoom < 0.5 ? 5 : state.zoom < 1 ? 2 : 1;
  const total = state.totalDuration + 10;

  for (let i = 0; i <= total; i += step) {
    const mark = document.createElement('div');
    mark.style.cssText = `position:absolute;left:${i * pxPerSec}px;bottom:0;font-size:9px;color:var(--txt3);user-select:none;transform:translateX(-50%)`;
    mark.textContent = i + 's';
    ruler.appendChild(mark);
  }
}

// === Clip Drag ===
function setupClipDrag(el: HTMLElement, clip: ClipData): void {
  let startX = 0;
  let startLeft = 0;
  let dragging = false;

  el.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).classList.contains('trim-handle') ||
        (e.target as HTMLElement).classList.contains('clip-delete')) return;
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startLeft = clip.startTime;
    el.style.cursor = 'grabbing';

    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dt = dx / (60 * state.zoom);
      clip.startTime = Math.max(0, startLeft + dt);
      renderTimeline();
    };

    const onUp = () => {
      dragging = false;
      el.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// === Trim Handles ===
function setupTrimHandles(el: HTMLElement, clip: ClipData): void {
  el.querySelectorAll('.trim-handle').forEach((handle: Element) => {
    (handle as HTMLElement).addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const side = handle.getAttribute('data-trim');
      const startX = e.clientX;
      const origStart = clip.startTime;
      const origDur = clip.duration;

      const onMove = (e: MouseEvent) => {
        const dx = e.clientX - startX;
        const dt = dx / (60 * state.zoom);

        if (side === 'left') {
          const newStart = Math.max(0, origStart + dt);
          const newDur = origDur - (newStart - origStart);
          if (newDur > 0.1) {
            clip.startTime = newStart;
            clip.duration = newDur;
          }
        } else {
          const newDur = Math.max(0.1, origDur + dt);
          clip.duration = newDur;
        }
        renderTimeline();
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

// === Context Menu ===
function showContextMenu(x: number, y: number, clipId: number): void {
  const menu = document.getElementById('context-menu');
  if (!menu) return;
  menu.style.display = '';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  menu.querySelectorAll('.ctx-item').forEach(item => {
    (item as HTMLElement).onclick = () => {
      const action = item.getAttribute('data-action');
      if (action === 'split') {
        const time = getCurrentPlayheadTime();
        splitClipAtPlayhead(time);
      } else if (action === 'duplicate') {
        duplicateClip(clipId);
      } else if (action === 'front') {
        bringToFront(clipId);
      } else if (action === 'back') {
        sendToBack(clipId);
      } else if (action === 'delete') {
        removeClip(clipId);
      }
      renderTimeline();
      renderMediaBin();
      renderProperties();
      renderEffects();
      renderTransitions();
      menu.style.display = 'none';
    };
  });

  const close = () => {
    menu.style.display = 'none';
    document.removeEventListener('click', close);
  };
  setTimeout(() => document.addEventListener('click', close), 10);
}

let _playheadGetter: (() => number) | null = null;
export function setPlayheadGetter(fn: () => number): void { _playheadGetter = fn; }
function getCurrentPlayheadTime(): number { return _playheadGetter ? _playheadGetter() : 0; }

// === Save / Load ===
export function saveProject(): string {
  const data = {
    version: 1,
    clips: state.clips.map(c => ({
      ...c,
      file: undefined,
      source: undefined,
      url: c.url,
    })),
  };
  return JSON.stringify(data, null, 2);
}

export function loadProject(json: string): void {
  try {
    const data = JSON.parse(json);
    if (data.version === 1 && Array.isArray(data.clips)) {
      saveState();
      state.clips = data.clips;
      state.selectedId = null;
      recalcDuration();
    }
  } catch (e) {
    console.error('Failed to load project:', e);
  }
}

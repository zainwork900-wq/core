import * as core from '@diffusionstudio/core-v4';

export interface ClipData {
  id: string;
  type: 'video' | 'audio' | 'image' | 'text';
  name: string;
  file?: File;
  url?: string;
  source?: any;
  startTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
  layerIndex: number;
  // Text specific
  text?: string;
  fontSize?: number;
  fontColor?: string;
  x?: number;
  y?: number;
  // Effects
  effects?: any[];
}

export interface EditorState {
  clips: ClipData[];
  selectedClipId: string | null;
  zoom: number;
  totalDuration: number;
  isPlaying: boolean;
}

let clipIdCounter = 0;
export function nextId(): string {
  return `clip_${++clipIdCounter}_${Date.now()}`;
}

export const state: EditorState = {
  clips: [],
  selectedClipId: null,
  zoom: 1,
  totalDuration: 10,
  isPlaying: false,
};

export function addClip(clip: ClipData) {
  state.clips.push(clip);
  recalcDuration();
  renderTimeline();
}

export function removeClip(id: string) {
  state.clips = state.clips.filter(c => c.id !== id);
  if (state.selectedClipId === id) state.selectedClipId = null;
  recalcDuration();
  renderTimeline();
}

export function selectClip(id: string | null) {
  state.selectedClipId = id;
  renderTimeline();
  renderProperties();
}

export function recalcDuration() {
  let max = 5;
  for (const c of state.clips) {
    const end = c.startTime + c.duration;
    if (end > max) max = end;
  }
  state.totalDuration = max + 2;
}

// === Timeline Rendering ===
export function renderTimeline() {
  const videoTrack = document.getElementById('track-video');
  const textTrack = document.getElementById('track-text');
  const audioTrack = document.getElementById('track-audio');
  const ruler = document.getElementById('timeline-ruler');
  if (!videoTrack || !textTrack || !audioTrack || !ruler) return;

  const pxPerSec = 60 * state.zoom;
  const width = state.totalDuration * pxPerSec;

  [videoTrack, textTrack, audioTrack].forEach(t => {
    t.innerHTML = '';
    t.style.width = width + 'px';
  });

  // Ruler
  ruler.innerHTML = '';
  ruler.style.width = width + 'px';
  for (let s = 0; s <= state.totalDuration; s += 1) {
    const mark = document.createElement('div');
    mark.style.cssText = `position:absolute;left:${s * pxPerSec}px;top:0;height:100%;border-left:1px solid ${s % 5 === 0 ? '#555' : '#333'};`;
    if (s % 5 === 0) {
      const label = document.createElement('span');
      label.textContent = formatTime(s);
      label.style.cssText = 'position:absolute;top:2px;left:4px;font-size:10px;color:#777;';
      mark.appendChild(label);
    }
    ruler.appendChild(mark);
  }

  // Clips
  for (const clip of state.clips) {
    const track = clip.type === 'audio' ? audioTrack :
                  clip.type === 'text' ? textTrack : videoTrack;

    const el = document.createElement('div');
    el.className = `tclip ${clip.type}${state.selectedClipId === clip.id ? ' selected' : ''}`;
    el.style.left = (clip.startTime * pxPerSec) + 'px';
    el.style.width = (clip.duration * pxPerSec) + 'px';
    el.dataset.id = clip.id;

    const label = document.createElement('span');
    label.textContent = clip.name;
    label.style.flex = '1';
    label.style.overflow = 'hidden';
    el.appendChild(label);

    const del = document.createElement('button');
    del.className = 'clip-delete';
    del.textContent = '×';
    del.onclick = (e) => { e.stopPropagation(); removeClip(clip.id); };
    el.appendChild(del);

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      selectClip(clip.id);
    });

    // Drag to move
    let dragging = false;
    let startX = 0;
    let origStart = 0;
    el.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).classList.contains('clip-delete')) return;
      dragging = true;
      startX = e.clientX;
      origStart = clip.startTime;
      e.preventDefault();
    });

    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dt = dx / pxPerSec;
      clip.startTime = Math.max(0, origStart + dt);
      recalcDuration();
      renderTimeline();
    };
    const onUp = () => { dragging = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    track.appendChild(el);
  }

  // Empty hints
  if (videoTrack.children.length === 0) {
    videoTrack.innerHTML = '<div class="track-hint">Drop video/image here</div>';
  }
  if (textTrack.children.length === 0) {
    textTrack.innerHTML = '<div class="track-hint">Click + Text to add</div>';
  }
  if (audioTrack.children.length === 0) {
    audioTrack.innerHTML = '<div class="track-hint">Drop audio here</div>';
  }

  const zoomEl = document.getElementById('zoom-level');
  if (zoomEl) zoomEl.textContent = Math.round(state.zoom * 100) + '%';
}

// === Properties Panel ===
export function renderProperties() {
  const panel = document.getElementById('props-panel');
  const content = document.getElementById('props-content');
  if (!panel || !content) return;

  const clip = state.clips.find(c => c.id === state.selectedClipId);
  if (!clip) { panel.style.display = 'none'; return; }

  panel.style.display = '';
  content.innerHTML = '';

  const addRow = (label: string, html: string) => {
    const row = document.createElement('div');
    row.className = 'prop-row';
    row.innerHTML = `<label>${label}</label>${html}`;
    content.appendChild(row);
    return row;
  };

  // Common props
  addRow('Start', `<input type="number" value="${clip.startTime.toFixed(1)}" step="0.1" min="0" data-prop="startTime" /> s`);
  addRow('Duration', `<input type="number" value="${clip.duration.toFixed(1)}" step="0.1" min="0.1" data-prop="duration" /> s`);

  // Text props
  if (clip.type === 'text') {
    addRow('Text', `<input type="text" value="${clip.text || ''}" data-prop="text" style="width:120px" />`);
    addRow('Size', `<input type="number" value="${clip.fontSize || 48}" min="8" max="200" data-prop="fontSize" /> px`);
    addRow('Color', `<input type="color" value="${clip.fontColor || '#ffffff'}" data-prop="fontColor" />`);
    addRow('Pos X', `<input type="number" value="${clip.x || 50}" min="0" max="100" data-prop="x" /> %`);
    addRow('Pos Y', `<input type="number" value="${clip.y || 50}" min="0" max="100" data-prop="y" /> %`);
  }

  // Effects for video/image
  if (clip.type === 'video' || clip.type === 'image') {
    const effects = clip.effects || [];
    const blur = effects.find((e: any) => e.type === 'blur');
    const brightness = effects.find((e: any) => e.type === 'brightness');

    addRow('Blur', `<input type="range" min="0" max="20" value="${blur ? blur.value : 0}" data-effect="blur" /><span class="prop-value">${blur ? blur.value : 0}</span>`);
    addRow('Brightness', `<input type="range" min="0" max="200" value="${brightness ? brightness.value : 100}" data-effect="brightness" /><span class="prop-value">${brightness ? brightness.value : 100}</span>`);
  }

  // Delete button
  const delRow = document.createElement('div');
  delRow.className = 'prop-row';
  delRow.style.justifyContent = 'center';
  delRow.style.paddingTop = '12px';
  delRow.innerHTML = `<button style="padding:6px 20px;border:1px solid var(--red);border-radius:4px;background:transparent;color:var(--red);cursor:pointer;font-size:12px" data-action="delete">Delete Clip</button>`;
  content.appendChild(delRow);

  // Event listeners
  content.querySelectorAll('[data-prop]').forEach(el => {
    el.addEventListener('change', (e) => {
      const prop = (e.target as HTMLElement).dataset.prop!;
      let val: any = (e.target as HTMLInputElement).value;
      if (['startTime', 'duration', 'fontSize', 'x', 'y'].includes(prop)) val = parseFloat(val);
      (clip as any)[prop] = val;
      recalcDuration();
      renderTimeline();
    });
  });

  content.querySelectorAll('[data-effect]').forEach(el => {
    el.addEventListener('input', (e) => {
      const type = (e.target as HTMLElement).dataset.effect!;
      const val = parseFloat((e.target as HTMLInputElement).value);
      if (!clip.effects) clip.effects = [];
      const existing = clip.effects.find((eff: any) => eff.type === type);
      if (existing) existing.value = val;
      else clip.effects.push({ type: type as any, value: val } as any);
      const span = (e.target as HTMLElement).nextElementSibling;
      if (span) span.textContent = String(val);
    });
  });

  content.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
    removeClip(clip.id);
  });
}

// === Media Bin ===
export function renderMediaBin() {
  const bin = document.getElementById('media-bin');
  if (!bin) return;
  bin.innerHTML = '';

  const media = state.clips.filter(c => c.type !== 'text');
  if (media.length === 0) {
    bin.innerHTML = '<div style="text-align:center;padding:20px;color:var(--txt3);font-size:12px">No media yet.<br>Click + to add.</div>';
    return;
  }

  for (const clip of media) {
    const item = document.createElement('div');
    item.className = `media-item${state.selectedClipId === clip.id ? ' selected' : ''}`;

    const thumb = document.createElement('div');
    thumb.className = 'media-thumb';
    if (clip.type === 'image' && clip.url) {
      thumb.innerHTML = `<img src="${clip.url}" />`;
    } else if (clip.type === 'video') {
      thumb.innerHTML = '<span class="icon">🎬</span>';
    } else {
      thumb.innerHTML = '<span class="icon">🎵</span>';
    }

    const info = document.createElement('div');
    info.className = 'media-info';
    info.innerHTML = `<div class="media-name">${clip.name}</div><div class="media-meta">${clip.type} · ${clip.duration.toFixed(1)}s</div>`;

    const del = document.createElement('button');
    del.className = 'media-delete';
    del.textContent = '×';
    del.onclick = (e) => { e.stopPropagation(); removeClip(clip.id); };

    item.appendChild(thumb);
    item.appendChild(info);
    item.appendChild(del);
    item.addEventListener('click', () => selectClip(clip.id));
    bin.appendChild(item);
  }
}

// === Helpers ===
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function getMediaType(file: File): 'video' | 'audio' | 'image' | null {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  return null;
}

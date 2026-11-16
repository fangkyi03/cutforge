// 一小套线性图标（16px，随文字颜色）。
const P = {
  play: '<path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M4.5 3.5h2.5v9H4.5zM9 3.5h2.5v9H9z" fill="currentColor" stroke="none"/>',
  start: '<path d="M4 3.5v9M12 3.5v9L6 8z"/>',
  eye: '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  eyeOff: '<path d="M2 2l12 12M6.2 4c.6-.3 1.200-.5 1.800-.5 4.100 0 6.500 4.500 6.500 4.500s-.7 1.300-2 2.500M9.900 12.200c-.6.2-1.200.3-1.900.3-4.100 0-6.500-4.500-6.500-4.500s.9-1.700 2.600-3"/>',
  vol: '<path d="M2.500 6v4h2.500l3.500 3V3L5 6zM11 5.500c.8.700 1.200 1.500 1.200 2.500s-.4 1.800-1.200 2.500"/>',
  mute: '<path d="M2.500 6v4h2.500l3.500 3V3L5 6zM11 6l3 4M14 6l-3 4"/>',
  lock: '<rect x="3.500" y="7" width="9" height="6.500" rx="1.500"/><path d="M5.500 7V5a2.500 2.500 0 015 0v2"/>',
  unlock: '<rect x="3.500" y="7" width="9" height="6.500" rx="1.500"/><path d="M5.500 7V5a2.500 2.500 0 014.800-1"/>',
  trash: '<path d="M3 4.500h10M6.500 4.500V3h3v1.500M4.500 4.500l.6 8.500h5.800l.6-8.500M7 7v3.500M9 7v3.500"/>',
  plus: '<path d="M8 3.500v9M3.500 8h9"/>',
  cut: '<circle cx="4.500" cy="4.500" r="2"/><circle cx="4.500" cy="11.500" r="2"/><path d="M6 6l7.500 6.500M6 10l7.500-6.500"/>',
  undo: '<path d="M5.500 3L2.500 6l3 3M2.500 6h6.500a4 4 0 010 8H7"/>',
  redo: '<path d="M10.500 3l3 3-3 3M13.500 6H7a4 4 0 000 8h2"/>',
  file: '<path d="M4 2h5l3 3v9H4zM9 2v3h3"/>',
  folder: '<path d="M2 4.500V12a1 1 0 001 1h10a1 1 0 001-1V6a1 1 0 00-1-1H8L6.500 3.500H3a1 1 0 00-1 1z"/>',
  page: '<path d="M5.500 5L2.500 8l3 3M10.500 5l3 3-3 3M9 3.500l-2 9"/>',
  video: '<rect x="2" y="4" width="8.500" height="8" rx="1.500"/><path d="M10.500 7l3.500-2v6l-3.500-2"/>',
  image: '<rect x="2" y="3" width="12" height="10" rx="1.500"/><circle cx="5.500" cy="6.500" r="1.200"/><path d="M2.500 11.500l3.500-3 2.500 2 2-1.500 3 2.500"/>',
  audio: '<path d="M6 12V4l6-1.500v8"/><circle cx="4.500" cy="12" r="1.500"/><circle cx="10.500" cy="10.500" r="1.500"/>',
  refresh: '<path d="M13 8a5 5 0 11-1.500-3.500M13 3v2.500h-2.500"/>',
  upload: '<path d="M8 10.500v-7M5 6l3-3 3 3M3 11v2h10v-2"/>',
  stop: '<rect x="4" y="4" width="8" height="8" rx="1.500" fill="currentColor" stroke="none"/>',
  send: '<path d="M8 13V3M4 7l4-4 4 4"/>',
  x: '<path d="M4 4l8 8M12 4l-8 8"/>',
  chevron: '<path d="M6 4l4 4-4 4"/>',
  caption: '<rect x="2" y="3.500" width="12" height="9" rx="1.500"/><path d="M4.500 8h3M9 8h2.500M4.500 10.500h7"/>',
  doc: '<path d="M4 2h8v12H4zM6 5.500h4M6 8h4M6 10.500h2.500"/>',
  magnet: '<path d="M4 2.500v5.500a4 4 0 008 0V2.500h-2.500V8a1.500 1.500 0 01-3 0V2.500zM4 5h2.500M9.500 5H12"/>',
  zoomIn: '<circle cx="7" cy="7" r="4.500"/><path d="M10.500 10.500L14 14M5 7h4M7 5v4"/>',
  zoomOut: '<circle cx="7" cy="7" r="4.500"/><path d="M10.500 10.500L14 14M5 7h4"/>',
  fit: '<path d="M2 8h12M2 8l2.500-2.500M2 8l2.500 2.500M14 8l-2.500-2.500M14 8l-2.500 2.500"/>',
  copy: '<rect x="5.500" y="5.500" width="8" height="8" rx="1.500"/><path d="M3.500 10.500h-1v-8h8v1"/>',
  sun: '<circle cx="8" cy="8" r="3"/><path d="M8 1.500v1.500M8 13v1.500M1.500 8H3M13 8h1.500M3.400 3.400l1.100 1.100M11.500 11.500l1.100 1.100M3.400 12.600l1.100-1.100M11.500 4.500l1.100-1.100"/>',
  moon: '<path d="M13 9.500A5.500 5.500 0 016.500 3a5.500 5.500 0 106.500 6.500z"/>',
  search: '<circle cx="7" cy="7" r="4.500"/><path d="M10.500 10.500L14 14"/>',
  expand: '<path d="M2.500 6V2.500H6M10 2.500h3.500V6M13.500 10v3.500H10M6 13.500H2.500V10"/>',
  aspect: '<rect x="2" y="3.500" width="12" height="9" rx="1.500"/><path d="M5 6.500h2M5 6.500v2M11 9.500H9M11 9.500v-2"/>',
  sliders: '<path d="M2.500 5h6M11.500 5h2M2.500 11h2M7.500 11h6"/><circle cx="10" cy="5" r="1.500"/><circle cx="6" cy="11" r="1.500"/>',
  chat: '<path d="M2.500 3.500h11v7.500H7l-3 2.500V11H2.500z"/>',
  alignL: '<path d="M2.500 2v12M5 5h7v2.500H5zM5 9.500h4.500V12H5z"/>',
  alignC: '<path d="M8 2v12M4 5h8v2.500H4zM5.500 9.500h5V12h-5z"/>',
  alignR: '<path d="M13.500 2v12M4 5h7v2.500H4zM6.500 9.500H11V12H6.500z"/>',
  alignT: '<path d="M2 2.500h12M5 5v7h2.500V5zM9.500 5v4.500H12V5z"/>',
  alignM: '<path d="M2 8h12M5 4v8h2.500V4zM9.500 5.500v5H12v-5z"/>',
  alignB: '<path d="M2 13.500h12M5 4v7h2.500V4zM9.500 6.500V11H12V6.500z"/>',
  code: '<path d="M5.500 5L2.500 8l3 3M10.500 5l3 3-3 3"/>',
  more: '<circle cx="3.500" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="12.500" cy="8" r="1" fill="currentColor"/>',
};

export function icon(name, size = 16) {
  const span = document.createElement('span');
  span.className = 'ic';
  span.innerHTML = `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  return span;
}

export const iconForFile = (path, dir) => {
  if (dir) return 'folder';
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (['html', 'htm'].includes(ext)) return 'page';
  if (['mp4', 'mov', 'webm', 'm4v', 'mkv'].includes(ext)) return 'video';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'].includes(ext)) return 'audio';
  if (ext === 'vtt' || ext === 'srt') return 'caption';
  return 'doc';
};

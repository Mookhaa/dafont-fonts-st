// DaFont Fonts - extensión de SillyTavern
// Carga fuentes de DaFont (.zip / .ttf / .otf / .woff / .woff2), las guarda en el navegador
// (IndexedDB) y las aplica a los mensajes del personaje y/o a los tuyos con CSS.
// No modifica tus chats: solo cambia cómo se ven.

import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const MODULE = 'dafont_fonts';
const DB_NAME = 'st-dafont-fonts';
const STORE = 'fonts';
const defaults = { fonts: [], charFont: '', userFont: '' };
const faces = new Map(); // id -> FontFace

/* ---------- Ajustes ---------- */
function getSettings() {
    if (!extension_settings[MODULE]) extension_settings[MODULE] = structuredClone(defaults);
    for (const k of Object.keys(defaults)) {
        if (extension_settings[MODULE][k] === undefined) extension_settings[MODULE][k] = structuredClone(defaults[k]);
    }
    return extension_settings[MODULE];
}

/* ---------- IndexedDB ---------- */
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function dbPut(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
async function dbGet(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE).objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function dbDelete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/* ---------- Lector de ZIP (sin librerías) ---------- */
async function unzipFonts(buf) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('El ZIP no es válido.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = [];
    for (let n = 0; n < count; n++) {
        if (dv.getUint32(p, true) !== 0x02014b50) break;
        const method = dv.getUint16(p + 10, true);
        const csize = dv.getUint32(p + 20, true);
        const nlen = dv.getUint16(p + 28, true);
        const elen = dv.getUint16(p + 30, true);
        const clen = dv.getUint16(p + 32, true);
        const off = dv.getUint32(p + 42, true);
        const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
        p += 46 + nlen + elen + clen;
        if (!/\.(ttf|otf|woff2?)$/i.test(name) || name.includes('__MACOSX')) continue;
        const ln = dv.getUint16(off + 26, true);
        const le = dv.getUint16(off + 28, true);
        const start = off + 30 + ln + le;
        const data = u8.subarray(start, start + csize);
        let bytes;
        if (method === 0) {
            bytes = data.slice();
        } else if (method === 8) {
            const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        } else continue;
        out.push({ name: name.split('/').pop(), bytes });
    }
    return out;
}

/* ---------- Utilidades ---------- */
function sniff(bytes) {
    const s4 = String.fromCharCode(...bytes.subarray(0, 4));
    if (s4.startsWith('PK')) return 'zip';
    if (s4 === 'wOF2' || s4 === 'wOFF' || s4 === 'OTTO' || s4 === 'true') return 'font';
    if (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) return 'font';
    return 'unknown';
}
function cleanName(file) {
    return file.replace(/\.(ttf|otf|woff2?|zip)$/i, '').replace(/[_-]+/g, ' ').trim() || 'Fuente';
}
function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Convierte un enlace de página de DaFont en su enlace de descarga.
function dafontDownloadUrl(url) {
    if (/dl\.dafont\.com/i.test(url)) return url;
    const m = url.match(/dafont\.com\/([^\/?#]+)\.font/i);
    if (m) return `https://dl.dafont.com/dl/?f=${m[1].replace(/-/g, '_')}`;
    return null;
}

/* ---------- Registro de fuentes ---------- */
async function registerFace(font, data) {
    const face = new FontFace(font.family, data);
    await face.load();
    document.fonts.add(face);
    faces.set(font.id, face);
}

async function addFontBytes(displayName, bytes, extra = {}) {
    const s = getSettings();
    const id = uid();
    const font = { id, name: displayName, family: `STDF_${id}`, ...extra };
    await registerFace(font, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    await dbPut({ id, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    s.fonts.push(font);
    saveSettingsDebounced();
    return font;
}

// Procesa bytes (zip o fuente suelta). Devuelve cuántas fuentes se agregaron.
async function ingest(fileName, bytes, customName) {
    const kind = sniff(bytes);
    if (kind === 'zip') {
        const list = await unzipFonts(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        if (!list.length) throw new Error('El ZIP no trae archivos de fuente (.ttf/.otf/.woff).');
        let added = 0;
        for (const f of list) {
            const name = (customName && list.length === 1) ? customName : cleanName(f.name);
            await addFontBytes(name, f.bytes);
            added++;
        }
        return added;
    }
    if (kind === 'font') {
        await addFontBytes(customName || cleanName(fileName), bytes);
        return 1;
    }
    throw new Error('Ese archivo no parece una fuente ni un ZIP.');
}

async function addFromUrl(rawUrl, customName) {
    let url = rawUrl.trim();
    if (!url) return;
    const dl = dafontDownloadUrl(url);
    const isDafont = !!dl;
    const target = dl || url;
    const guessName = customName || (isDafont ? cleanName(url.match(/f=([^&]+)/)?.[1] || url.match(/dafont\.com\/([^\/?#]+)\.font/i)?.[1] || 'DaFont') : cleanName(target.split('/').pop().split('?')[0]));

    const attempts = [target, `/proxy/${target}`]; // 2.º intento: proxy CORS de SillyTavern (si lo tienes activado)
    let bytes = null;
    for (const a of attempts) {
        try {
            const res = await fetch(a);
            if (!res.ok) continue;
            bytes = new Uint8Array(await res.arrayBuffer());
            if (sniff(bytes) !== 'unknown') break;
            bytes = null;
        } catch { /* probamos el siguiente */ }
    }
    if (!bytes) {
        if (isDafont) {
            toastr.warning(`DaFont no deja que el navegador descargue directo. Descarga el .zip aquí: ${target} y súbelo con el botón "Subir archivo". (O activa enableCorsProxy en config.yaml para que funcione solo con el enlace.)`, 'DaFont Fonts', { timeOut: 15000 });
        } else {
            toastr.error('No pude descargar ese enlace (probablemente bloqueado por CORS). Descarga el archivo y súbelo con el botón.', 'DaFont Fonts');
        }
        return;
    }
    const n = await ingest(target.split('/').pop(), bytes, guessName);
    toastr.success(`${n} fuente(s) agregada(s).`, 'DaFont Fonts');
}

async function removeFont(id) {
    const s = getSettings();
    s.fonts = s.fonts.filter(f => f.id !== id);
    if (s.charFont === id) s.charFont = '';
    if (s.userFont === id) s.userFont = '';
    const face = faces.get(id);
    if (face) { document.fonts.delete(face); faces.delete(id); }
    try { await dbDelete(id); } catch { /* ignorar */ }
    saveSettingsDebounced();
    applyStyles();
    renderUI();
}

/* ---------- Aplicar a los mensajes (solo CSS, no toca el chat) ---------- */
function rule(selector, family) {
    const parts = ['', ' p', ' em', ' i', ' b', ' strong', ' q', ' span'];
    return parts.map(p => `${selector}${p}`).join(',\n') + ` { font-family: "${family}", sans-serif !important; }\n`;
}
function applyStyles() {
    const s = getSettings();
    let css = '';
    const char = s.fonts.find(f => f.id === s.charFont);
    const user = s.fonts.find(f => f.id === s.userFont);
    if (char) css += rule('#chat .mes[is_user="false"]:not([is_system="true"]) .mes_text', char.family);
    if (user) css += rule('#chat .mes[is_user="true"] .mes_text', user.family);
    let el = document.getElementById('stdf-style');
    if (!el) { el = document.createElement('style'); el.id = 'stdf-style'; document.head.appendChild(el); }
    el.textContent = css;
}

/* ---------- Interfaz ---------- */
function optionsHtml(selected) {
    const s = getSettings();
    return `<option value="">(Predeterminada)</option>` + s.fonts.map(f =>
        `<option value="${f.id}" ${f.id === selected ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
}

function renderUI() {
    const s = getSettings();
    $('#stdf_char').html(optionsHtml(s.charFont));
    $('#stdf_user').html(optionsHtml(s.userFont));
    const list = $('#stdf_list').empty();
    if (!s.fonts.length) {
        list.append('<div class="stdf-empty">Aún no has agregado fuentes.</div>');
        return;
    }
    for (const f of s.fonts) {
        const item = $(`
            <div class="stdf-item">
                <div class="stdf-preview" style="font-family:'${f.family}', sans-serif">Hola, así se ve ${esc(f.name)}</div>
                <div class="stdf-name">${esc(f.name)}</div>
                <i class="stdf-del fa-solid fa-trash-can" title="Eliminar"></i>
            </div>`);
        item.find('.stdf-del').on('click', () => removeFont(f.id));
        list.append(item);
    }
}

function buildUI() {
    const html = `
    <div class="stdf-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>DaFont Fonts</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="stdf-block">
                    <label>Agregar fuente</label>
                    <div class="stdf-row">
                        <input id="stdf_url" class="text_pole" type="text" placeholder="Enlace de DaFont, catbox, o archivo .ttf/.otf/.zip">
                    </div>
                    <div class="stdf-row">
                        <input id="stdf_name" class="text_pole" type="text" placeholder="Nombre (opcional)">
                        <div id="stdf_add_url" class="menu_button">Agregar enlace</div>
                        <div id="stdf_upload" class="menu_button">Subir archivo</div>
                        <input id="stdf_file" type="file" accept=".zip,.ttf,.otf,.woff,.woff2" multiple hidden>
                    </div>
                    <div class="stdf-hint">
                        Lo más fácil: descarga el .zip de DaFont y súbelo con "Subir archivo" (se abre solo, no hace falta catbox).
                        También sirve un enlace directo a un archivo de fuente (ej. catbox). Las fuentes se guardan en tu navegador.
                    </div>
                </div>
                <div class="stdf-block">
                    <label>Fuente de los mensajes del personaje</label>
                    <select id="stdf_char" class="text_pole"></select>
                    <label>Fuente de tus mensajes</label>
                    <select id="stdf_user" class="text_pole"></select>
                </div>
                <div class="stdf-block">
                    <label>Fuentes guardadas</label>
                    <div id="stdf_list" class="stdf-list"></div>
                </div>
            </div>
        </div>
    </div>`;
    $('#extensions_settings2').append(html);

    $('#stdf_char').on('change', function () { getSettings().charFont = String($(this).val()); saveSettingsDebounced(); applyStyles(); });
    $('#stdf_user').on('change', function () { getSettings().userFont = String($(this).val()); saveSettingsDebounced(); applyStyles(); });

    $('#stdf_add_url').on('click', async () => {
        try {
            await addFromUrl(String($('#stdf_url').val()), String($('#stdf_name').val()).trim());
            $('#stdf_url').val(''); $('#stdf_name').val('');
            applyStyles(); renderUI();
        } catch (e) { toastr.error(e.message, 'DaFont Fonts'); }
    });
    $('#stdf_upload').on('click', () => $('#stdf_file').trigger('click'));
    $('#stdf_file').on('change', async function () {
        const custom = String($('#stdf_name').val()).trim();
        let total = 0;
        for (const file of this.files) {
            try {
                const bytes = new Uint8Array(await file.arrayBuffer());
                total += await ingest(file.name, bytes, this.files.length === 1 ? custom : '');
            } catch (e) { toastr.error(`${file.name}: ${e.message}`, 'DaFont Fonts'); }
        }
        this.value = '';
        if (total) { toastr.success(`${total} fuente(s) agregada(s).`, 'DaFont Fonts'); $('#stdf_name').val(''); }
        applyStyles(); renderUI();
    });
}

/* ---------- Inicio ---------- */
async function loadSavedFonts() {
    const s = getSettings();
    for (const font of s.fonts) {
        try {
            const rec = await dbGet(font.id);
            if (rec) await registerFace(font, rec.bytes);
        } catch (e) { console.warn('[DaFont Fonts] No se pudo cargar', font.name, e); }
    }
}

jQuery(async () => {
    getSettings();
    buildUI();
    await loadSavedFonts();
    applyStyles();
    renderUI();
});

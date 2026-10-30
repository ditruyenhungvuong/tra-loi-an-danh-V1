/* =========================================================
   Lưu trữ localStorage – mọi thao tác có try/catch (chế độ riêng tư, đầy, bị chặn)
   Khóa (tech design 3.3):
     tlad_device    "k3f9…" 16 ký tự [a-z0-9], tạo lần đầu, không đổi
     tlad_join      { room, createdAt, answered: { "<q>": "<câu đã gửi>" } }
     tlad_host_key  chuỗi khóa người dẫn (nạp từ ?key=, xóa khỏi URL ngay)
     tlad_host      { room, createdAt, reveal: { "<q>": { revealed:[id…], hidden:[id…] } } }
   Không có gì khác: không tên, không SĐT, không câu trả lời của người khác.
   ========================================================= */
window.APP_STORE = (function () {
  'use strict';
  const KEYS = { device: 'tlad_device', join: 'tlad_join', hostKey: 'tlad_host_key', host: 'tlad_host' };
  const DEVICE_RE = /^[a-z0-9]{8,32}$/;

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) {
    try { localStorage.setItem(k, v); return true; }
    catch (e) { console.warn('tlad: không ghi được localStorage ' + k, e); return false; }
  }
  function del(k) { try { localStorage.removeItem(k); } catch (e) { /* bỏ qua */ } }
  function getJSON(k) {
    try { const raw = get(k); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  const setJSON = (k, obj) => set(k, JSON.stringify(obj));

  /* localStorage có dùng được không (để toast nhắc ở màn dẫn khi không nhớ được số đã hiện) */
  function available() {
    try { const t = '__tlad_test'; localStorage.setItem(t, '1'); localStorage.removeItem(t); return true; }
    catch (e) { return false; }
  }

  /* deviceId: tạo lần đầu; thiếu localStorage thì giữ trong bộ nhớ cho phiên này (R14) */
  let memDevice = '';
  function getDeviceId() {
    let id = get(KEYS.device);
    if (!DEVICE_RE.test(id || '')) {
      id = memDevice || window.APP_UI.newId(16);
      memDevice = id;
      set(KEYS.device, id);
    }
    return id;
  }

  /* Phiên tham gia */
  const join = {
    load() {
      const j = getJSON(KEYS.join);
      if (!j || typeof j !== 'object') return null;
      return { room: String(j.room || ''), createdAt: String(j.createdAt || ''), answered: (j.answered && typeof j.answered === 'object') ? j.answered : {} };
    },
    save(obj) { return setJSON(KEYS.join, { room: obj.room, createdAt: obj.createdAt, answered: obj.answered || {} }); },
    clear() { del(KEYS.join); }
  };

  /* Người dẫn */
  const host = {
    getKey() { return get(KEYS.hostKey) || ''; },
    setKey(k) { return set(KEYS.hostKey, String(k || '')); },
    clearKey() { del(KEYS.hostKey); },
    load() {
      const h = getJSON(KEYS.host);
      if (!h || typeof h !== 'object' || !h.room) return null;
      return { room: String(h.room), createdAt: String(h.createdAt || ''), reveal: (h.reveal && typeof h.reveal === 'object') ? h.reveal : {} };
    },
    save(obj) { return setJSON(KEYS.host, { room: obj.room, createdAt: obj.createdAt, reveal: obj.reveal || {} }); },
    clear() { del(KEYS.host); }
  };

  /* "Xóa dấu vết trên máy này" (P1): bỏ deviceId và phiên tham gia */
  function forgetDevice() { del(KEYS.device); del(KEYS.join); memDevice = ''; }

  return { KEYS, available, getDeviceId, join, host, forgetDevice };
})();

/* =========================================================
   Thư viện Chrome DevTools Protocol tối giản cho test E2E (QA) – Trả lời ẩn danh.
   Chép từ apps/checkin-vao-ca/tests/lib/cdp.js và mở rộng cho app hai vai:
   - launch(): mở MỘT Chrome headless (--remote-debugging-port=0, user-data-dir riêng),
     chỉ tắt đúng tiến trình Chrome do test sinh ra (child.kill theo PID), KHÔNG đụng Chrome của người dùng.
   - browser.newPage({ isolated, width, height, mobile }): mở một tab mới. isolated=true → tạo
     browser context riêng (localStorage/cookie riêng) để giả "một điện thoại khác"; isolated=false
     → dùng context mặc định (hai tab host cùng profile để thử BroadcastChannel).
   - Page: send, on, evaluate, navigate, reload, click, type, key, screenshot, close.
   Không dependency ngoài Node ≥ 22 (WebSocket và fetch có sẵn).
   ========================================================= */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Kết nối WebSocket CDP dùng chung cho browser và page */
class Conn {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message + ' (' + (m.error.data || '') + ')')) : resolve(m.result);
      } else if (m.method) {
        (this.listeners.get(m.method) || []).forEach(fn => { try { fn(m.params); } catch (e) { /* bỏ qua */ } });
      }
    };
  }
  send(method, params) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  once(method) { return new Promise(r => this.on(method, r)); }
  close() { try { this.ws.close(); } catch (e) { /* bỏ qua */ } }
}

class Page extends Conn {
  constructor(ws, browser, targetId, contextId) {
    super(ws);
    this.browser = browser;
    this.targetId = targetId;
    this.contextId = contextId;
    this.closed = false;
  }
  /* Chạy biểu thức trong trang, trả về giá trị JSON. Biểu thức có thể là Promise. */
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('evaluate: ' + (d.exception && d.exception.description || d.text));
    }
    return r.result.value;
  }
  async navigate(url) {
    const loaded = this.once('Page.loadEventFired');
    await this.send('Page.navigate', { url });
    await loaded;
  }
  /* F5 */
  async reload() {
    const loaded = this.once('Page.loadEventFired');
    await this.send('Page.reload', { ignoreCache: true });
    await loaded;
  }
  /* Tọa độ tâm phần tử (theo viewport) để click thật bằng chuột */
  async center(selector) {
    const r = await this.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    if (!r) throw new Error('không thấy ' + selector);
    return r;
  }
  async click(selector, clickCount) {
    const { x, y } = await this.center(selector);
    const n = clickCount || 1;
    for (let i = 1; i <= n; i++) {
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: i });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: i });
    }
  }
  /* Gõ chữ thật vào phần tử đang focus (sinh sự kiện input như bàn phím) */
  async type(text) { await this.send('Input.insertText', { text }); }
  /* Bấm một phím thật */
  async key(name) {
    const map = {
      Tab: { key: 'Tab', code: 'Tab', vk: 9 },
      Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
      Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
      Escape: { key: 'Escape', code: 'Escape', vk: 27 },
      Home: { key: 'Home', code: 'Home', vk: 36 },
      End: { key: 'End', code: 'End', vk: 35 },
      PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
      PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
      ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
      ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
      Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 }
    };
    const k = map[name];
    if (!k) throw new Error('phím lạ ' + name);
    const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
    await this.send('Input.dispatchKeyEvent', Object.assign({ type: k.text ? 'keyDown' : 'rawKeyDown' }, base, k.text ? { text: k.text, unmodifiedText: k.text } : {}));
    await this.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  }
  async screenshot(file, fullPage) {
    const params = { format: 'png' };
    if (fullPage) {
      const m = await this.send('Page.getLayoutMetrics');
      const cs = m.cssContentSize || m.contentSize;
      params.captureBeyondViewport = true;
      params.clip = { x: 0, y: 0, width: Math.ceil(cs.width), height: Math.ceil(cs.height), scale: 1 };
    }
    const r = await this.send('Page.captureScreenshot', params);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
  /* Đóng tab (như người dùng đóng trang) – context riêng thì bỏ luôn context */
  async close() {
    if (this.closed) return;
    this.closed = true;
    super.close();
    try { await this.browser.send('Target.closeTarget', { targetId: this.targetId }); } catch (e) { /* đã đóng */ }
    if (this.contextId) { try { await this.browser.send('Target.disposeBrowserContext', { browserContextId: this.contextId }); } catch (e) { /* bỏ qua */ } }
  }
}

class Browser extends Conn {
  constructor(ws, port, child) {
    super(ws);
    this.port = port;
    this.child = child;
    this.pages = [];
  }
  /* Mở tab mới. opts: isolated (context riêng), contextId (dùng lại context của tab khác), width, height, mobile, scale */
  async newPage(opts) {
    const o = opts || {};
    let contextId = o.contextId || null;
    let ownContext = false;
    if (!contextId && o.isolated) { contextId = (await this.send('Target.createBrowserContext', { disposeOnDetach: true })).browserContextId; ownContext = true; }
    /* Tab trong context mới = cửa sổ mới (đặt được kích thước); tab dùng lại context thì mở như tab thường */
    const params = ownContext || !contextId ? { url: 'about:blank', width: o.width || 375, height: o.height || 667 } : { url: 'about:blank' };
    if (contextId) params.browserContextId = contextId;
    const { targetId } = await this.send('Target.createTarget', params);
    let info = null;
    for (let i = 0; i < 50 && !info; i++) {
      try { info = (await (await fetch('http://127.0.0.1:' + this.port + '/json/list')).json()).find(t => t.id === targetId); } catch (e) { /* chờ */ }
      if (!info) await sleep(100);
    }
    if (!info) throw new Error('không thấy target vừa tạo');
    const ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const page = new Page(ws, this, targetId, ownContext ? contextId : null);
    page.sharedContextId = contextId;
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await page.send('Log.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: o.width || 375, height: o.height || 667, deviceScaleFactor: o.scale || 1, mobile: !!o.mobile });
    this.pages.push(page);
    return page;
  }
  kill() {
    this.pages.forEach(p => { try { p.ws.close(); } catch (e) { /* bỏ qua */ } });
    this.close();
    try { this.child.kill(); } catch (e) { /* đã tắt */ }
  }
}

/* Mở Chrome headless; trả Browser (có .kill() tắt đúng PID của test) */
async function launch(opts) {
  const o = opts || {};
  const ud = o.userDataDir;
  fs.rmSync(ud, { recursive: true, force: true });
  fs.mkdirSync(ud, { recursive: true });
  const args = [
    '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + ud,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--mute-audio', '--hide-scrollbars',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--window-size=' + (o.width || 1280) + ',' + (o.height || 720)
  ].concat(o.extraArgs || [], ['about:blank']);
  const child = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  try {
    const portFile = path.join(ud, 'DevToolsActivePort');
    let port = '';
    for (let i = 0; i < 300 && !port; i++) {
      try { port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim(); } catch (e) { port = ''; }
      if (!/^\d+$/.test(port)) { port = ''; await sleep(100); }
    }
    if (!port) throw new Error('Chrome không mở cổng debug:\n' + stderr);
    let version = null;
    for (let i = 0; i < 50 && !version; i++) {
      try { version = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json(); } catch (e) { await sleep(100); }
    }
    if (!version) throw new Error('Chrome không trả /json/version');
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const browser = new Browser(ws, port, child);
    return browser;
  } catch (e) {
    try { child.kill(); } catch (e2) { /* đã tắt */ }
    throw e;
  }
}

module.exports = { launch, sleep, CHROME };

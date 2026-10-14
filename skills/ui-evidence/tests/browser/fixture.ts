import http from "node:http";

const PAGE = `<!doctype html><html><body>
<nav style="display:none"><span>Schedule</span><span>Draft banner</span></nav>
<h1>Schedule</h1>
<p id="banner" style="display:none">Draft banner</p>
<a data-testid="go-b" href="#" onclick="setTimeout(()=>history.pushState({},'','/b'),300);return false">Go B</a>
<input data-testid="note-input" aria-label="Note" />
<button data-testid="save-renamed" onclick="document.getElementById('out').textContent='Saved!'">Save</button>
<button data-testid="noop" onclick="void 0">Do nothing</button>
<span data-testid="dup" hidden>dup hidden</span><span data-testid="dup">dup one</span><span data-testid="dup">dup two</span>
<button data-testid="hidden-btn" style="display:none" onclick="document.getElementById('out').textContent='Saved!'">Hidden save</button>
<div data-testid="hscroll" style="width:200px;height:60px;overflow:auto"><div style="width:1000px;height:300px">wide</div></div>
<button data-testid="row-open" onclick="document.getElementById('out').textContent='Opened 0'">Row A</button>
<button data-testid="row-open" onclick="document.getElementById('out').textContent='Opened 1'">Row B</button>
<div id="out"></div>
</body></html>`;

// /dnd: a pointer-event drag in the style of dnd-kit's PointerSensor (no drag
// until 6px of travel). The overlay shows while dragging; "slow-card" leaves
// its overlay up for a second after the drop, like a lingering drag ghost.
// #flag reads a localStorage key on load, for the script-level overrides.
const DND_PAGE = `<!doctype html><html><body style="margin:0">
<p id="flag"></p>
<div data-testid="card" style="position:absolute;left:20px;top:60px;width:100px;height:40px;background:#9cf">Card</div>
<div data-testid="slow-card" style="position:absolute;left:20px;top:120px;width:100px;height:40px;background:#fc9">Slow card</div>
<div data-testid="lane" style="position:absolute;left:300px;top:60px;width:200px;height:200px;background:#eee">Lane</div>
<div id="dropped"></div>
<script>
document.getElementById("flag").textContent = localStorage.getItem("dnd-flag") === "on" ? "Flag on" : "Flag off";
let drag = null;
document.addEventListener("pointerdown", (e) => {
  const card = e.target.closest('[data-testid$="card"]');
  if (card) drag = { card, x: e.clientX, y: e.clientY, active: false };
});
document.addEventListener("pointermove", (e) => {
  if (!drag || drag.active || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
  drag.active = true;
  const overlay = document.createElement("div");
  overlay.dataset.testid = "drag-overlay";
  overlay.textContent = "Dragging";
  document.body.appendChild(overlay);
});
document.addEventListener("pointerup", (e) => {
  const d = drag;
  drag = null;
  if (!d || !d.active) return;
  const lane = document.querySelector('[data-testid="lane"]').getBoundingClientRect();
  const inLane = e.clientX >= lane.left && e.clientX <= lane.right && e.clientY >= lane.top && e.clientY <= lane.bottom;
  if (inLane) document.getElementById("dropped").textContent = d.card.dataset.testid + " dropped at " + Math.round(e.clientX - lane.left) + "," + Math.round(e.clientY - lane.top) + (e.altKey ? " with Alt" : "");
  const overlay = document.querySelector('[data-testid="drag-overlay"]');
  if (d.card.dataset.testid === "slow-card") setTimeout(() => overlay.remove(), 1000); else overlay.remove();
});
</script>
</body></html>`;

export async function startFixture(): Promise<{ host: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => { res.setHeader("content-type", "text/html"); res.end(_req.url === "/dnd" ? DND_PAGE : PAGE); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return { host: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

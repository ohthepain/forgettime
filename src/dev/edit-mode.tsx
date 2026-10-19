/** Removable, opt-in development feedback UI. Never imported in production. */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

type Target = { selector: string; tag: string; label: string };
type Size = { width: number; height: number };
type Request = {
  id: string;
  kind: "comment" | "delete" | "resize";
  path: string;
  target?: Target;
  text: string;
  selected: boolean;
  viewport: Size;
  original?: Size;
  requested?: Size;
  previous?: Size;
};
type Store = {
  enabled: boolean;
  requests: Request[];
  revision: number;
  submitted?: { revision: number; ids: string[]; report: string };
};
const key = "forgettime:visual-feedback:v1";
let storageAvailable = true;
let stored: Store = { enabled: false, requests: [], revision: 0 };
try {
  stored = JSON.parse(sessionStorage.getItem(key) || "null") || stored;
} catch {
  storageAvailable = false;
}
const option = new URLSearchParams(location.search).get("editMode");
if (option !== null) stored.enabled = option === "1";
function persist(value: Store) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    storageAvailable = false;
  }
}
persist(stored);
const viewport = (): Size => ({ width: innerWidth, height: innerHeight });
const label = (el: Element) =>
  (
    el.getAttribute("aria-label") ||
    el.getAttribute("title") ||
    (el.matches("input,textarea,select") ? el.getAttribute("name") : el.textContent) ||
    ""
  )
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 90);
function identify(el: HTMLElement): Target {
  let selector = el.id
    ? `#${CSS.escape(el.id)}`
    : el.dataset.testid
      ? `[data-testid="${CSS.escape(el.dataset.testid)}"]`
      : "";
  if (!selector) {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node !== document.body && parts.length < 12) {
      const parent: Element | null = node.parentElement;
      parts.unshift(
        `${node.tagName.toLowerCase()}:nth-child(${parent ? [...parent.children].indexOf(node) + 1 : 1})`,
      );
      node = parent;
    }
    selector = `body > ${parts.join(" > ")}`;
  }
  return { selector, tag: el.tagName, label: label(el) };
}
function resolve(target?: Target): HTMLElement | undefined {
  if (!target) return;
  const nodes = document.querySelectorAll<HTMLElement>(target.selector);
  if (nodes.length !== 1) return;
  const el = nodes[0];
  return el.tagName === target.tag && label(el) === target.label ? el : undefined;
}
const same = (a?: Target, b?: Target) =>
  !!a && !!b && a.selector === b.selector && a.label === b.label;
if (stored.enabled && !document.getElementById("dev-edit-mode")) {
  const host = document.createElement("div");
  host.id = "dev-edit-mode";
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `:host{all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646;font:14px system-ui;color:#fff}*{box-sizing:border-box}button,input,textarea,select{font:inherit}button,input,textarea,select,.panel{pointer-events:auto}button{cursor:pointer;border:1px solid #5b6780;border-radius:7px;background:#26344c;color:white;padding:7px 10px}button:hover{background:#405378}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #f7c75b}button:disabled{opacity:.5}input,textarea,select{color:#fff;background:#111923;border:1px solid #8291ab;padding:7px;border-radius:5px;max-width:100%}textarea{width:100%;min-height:90px}label{display:block;margin:8px 0}small{display:block;color:#c2cde0;margin:6px 0}.toolbar{position:fixed;bottom:12px;left:12px;display:flex;gap:6px;flex-wrap:wrap;max-width:calc(100vw - 24px);background:#172237;padding:8px;border:1px solid #7684a0;border-radius:12px;pointer-events:auto;box-shadow:0 4px 20px #0008}.panel{position:fixed;right:12px;top:12px;width:min(420px,calc(100vw - 24px));max-height:calc(100dvh - 95px);overflow:auto;background:#172237;padding:16px;border:1px solid #8496b6;border-radius:12px;box-shadow:0 5px 30px #0009}.outline{position:fixed;border:2px solid #fbaf39;border-radius:3px;pointer-events:none}.tools{position:fixed;display:flex;gap:3px;pointer-events:auto}.ghost{position:fixed;border:3px dashed #53d8df;background:#53d8df22;pointer-events:none}.mark{position:fixed;background:#f75c5c33;border:2px solid #f98585;pointer-events:none}.badge{position:fixed;pointer-events:auto;background:#733334;border-radius:5px;padding:3px;font-size:11px}.row{border-top:1px solid #4c5b75;padding:10px 0;overflow-wrap:anywhere}.row label{display:flex;gap:8px}.actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}h2{font-size:18px;margin:0 0 12px}p{margin:8px 0}pre{white-space:pre-wrap;font:12px monospace}.resize{position:fixed;pointer-events:auto;cursor:nwse-resize;background:#b34cda;touch-action:none}.notice{color:#ffdc83}`;
  shadow.append(style);
  const mount = document.createElement("div");
  shadow.append(mount);
  createRoot(mount).render(<Feedback />);
  function Feedback() {
    const [store, setStore] = useState(stored);
    const [hidden, setHidden] = useState(false);
    const [review, setReview] = useState(false);
    const [target, setTarget] = useState<HTMLElement>();
    const [editor, setEditor] = useState<{ target?: Target; id?: string; resize?: boolean }>();
    const [text, setText] = useState("");
    const [width, setWidth] = useState(100);
    const [height, setHeight] = useState(100);
    const [picker, setPicker] = useState(false);
    const [report, setReport] = useState(stored.submitted?.report || "");
    const [message, setMessage] = useState("");
    const [ghost, setGhost] = useState<{ x: number; y: number; width: number; height: number }>();
    const [, tick] = useState(0);
    useEffect(() => {
      // Follow app layout without touching its styles or rerendering at audio frame rate.
      const interval = setInterval(() => tick((v) => v + 1), 100);
      return () => clearInterval(interval);
    }, []);
    useEffect(() => {
      if (hidden || review || editor || picker || ghost) return;
      let timer: ReturnType<typeof setTimeout>;
      const hover = (event: PointerEvent) => {
        clearTimeout(timer);
        if (event.composedPath().includes(host)) return;
        const el = event.target;
        if (el instanceof HTMLElement && el !== document.body && el !== document.documentElement)
          timer = setTimeout(() => setTarget(el), 220);
      };
      document.addEventListener("pointermove", hover);
      return () => {
        clearTimeout(timer);
        document.removeEventListener("pointermove", hover);
      };
    }, [hidden, review, editor, picker, ghost]);
    function change(requests: Request[]) {
      setStore((old) => {
        const next = { ...old, requests, revision: old.revision + 1, submitted: undefined };
        persist(next);
        return next;
      });
      setReport("");
    }
    function add(
      kind: Request["kind"],
      identity?: Target,
      body = "",
      dimensions?: { original: Size; requested: Size },
    ) {
      const previous =
        kind === "resize"
          ? store.requests.find(
              (r) => r.kind === kind && r.path === location.pathname && same(r.target, identity),
            )
          : undefined;
      const request: Request = {
        id: previous?.id || crypto.randomUUID(),
        kind,
        path: location.pathname,
        target: identity,
        text: body,
        viewport: viewport(),
        selected: previous?.selected ?? true,
        ...dimensions,
        previous: previous?.requested,
      };
      change([...store.requests.filter((r) => r.id !== request.id), request]);
    }
    function remove(id: string) {
      change(store.requests.filter((r) => r.id !== id));
    }
    function openComment(identity?: Target, id?: string) {
      setEditor({ target: identity, id });
      setText(store.requests.find((r) => r.id === id)?.text || "");
    }
    function resizeEditor() {
      if (!target) return;
      const rect = target.getBoundingClientRect();
      setWidth(Math.round(rect.width));
      setHeight(Math.round(rect.height));
      setEditor({ target: identify(target), resize: true });
    }
    function undo(r: Request) {
      if (r.previous)
        change(
          store.requests.map((item) =>
            item.id === r.id ? { ...r, requested: r.previous, previous: undefined } : item,
          ),
        );
      else remove(r.id);
    }
    function exportReport() {
      const selected = store.requests.filter((r) => r.selected);
      const value = JSON.stringify(
        {
          project: "Forgettime",
          revision: store.revision,
          selectedIds: selected.map((r) => r.id),
          requests: selected,
          note: "Feedback only. Present numbered concrete proposals and obtain explicit confirmation in chat before product edits.",
        },
        null,
        2,
      );
      setReport(value);
      const next = {
        ...store,
        submitted: { revision: store.revision, ids: selected.map((r) => r.id), report: value },
      };
      setStore(next);
      persist(next);
      setMessage("Copy this report into chat. I’ll propose fixes for your confirmation.");
    }
    const rect = target?.isConnected ? target.getBoundingClientRect() : undefined;
    const visible = !hidden && !review && !editor && !picker && rect && rect.width > 0;
    const clampX = (x: number, width = 160) => Math.max(4, Math.min(innerWidth - width - 4, x));
    const clampY = (y: number, height = 36) => Math.max(4, Math.min(innerHeight - height - 4, y));
    const candidates = picker
      ? [
          ...document.querySelectorAll<HTMLElement>(
            "button,a,input,select,textarea,[role],h1,h2,h3,canvas,svg,section",
          ),
        ]
          .filter(
            (el) =>
              !host.contains(el) &&
              el.getBoundingClientRect().width &&
              el.getBoundingClientRect().height,
          )
          .slice(0, 250)
      : [];
    return (
      <>
        {!hidden &&
          store.requests
            .filter((r) => r.path === location.pathname && r.kind === "delete")
            .map((r) => {
              const el = resolve(r.target);
              if (!el) return null;
              const b = el.getBoundingClientRect();
              return (
                <div key={r.id}>
                  <div
                    className="mark"
                    style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
                  />
                  <div
                    className="badge"
                    style={{ left: clampX(b.left, 220), top: clampY(b.bottom + 3, 30) }}
                  >
                    Marked for deletion <button onClick={() => remove(r.id)}>Undo</button>
                  </div>
                </div>
              );
            })}
        {visible && (
          <>
            <div
              className="outline"
              style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
            />
            <div
              className="tools"
              style={{ left: clampX(rect.right - 165, 210), top: clampY(rect.top - 36) }}
            >
              <button
                aria-label="Comment on element"
                onClick={() => openComment(identify(target!))}
              >
                💬
              </button>
              <button
                aria-label="Mark element for deletion"
                onClick={() => {
                  const identity = identify(target!);
                  if (
                    !store.requests.some(
                      (r) =>
                        r.kind === "delete" &&
                        r.path === location.pathname &&
                        same(r.target, identity),
                    )
                  )
                    add("delete", identity, "Remove this element");
                }}
              >
                🗑
              </button>
              <button
                onClick={() => {
                  if (target?.parentElement && target.parentElement !== document.body)
                    setTarget(target.parentElement);
                }}
              >
                Parent
              </button>
              <button aria-label="Enter requested dimensions" onClick={resizeEditor}>
                Size
              </button>
            </div>
            <button
              className="resize"
              aria-label="Drag to request size"
              style={{ left: clampX(rect.right - 18, 30), top: clampY(rect.bottom - 18, 30) }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                const identity = identify(target!);
                const original = { width: Math.round(rect.width), height: Math.round(rect.height) };
                const startX = event.clientX;
                const startY = event.clientY;
                let requested = original;
                setGhost({ x: rect.left, y: rect.top, ...original });
                const handle = event.currentTarget;
                const move = (e: PointerEvent) => {
                  requested = {
                    width: Math.max(20, Math.round(original.width + e.clientX - startX)),
                    height: Math.max(20, Math.round(original.height + e.clientY - startY)),
                  };
                  setGhost({ x: rect.left, y: rect.top, ...requested });
                };
                const finish = (commit: boolean) => {
                  handle.removeEventListener("pointermove", move);
                  handle.removeEventListener("pointerup", up);
                  handle.removeEventListener("pointercancel", cancel);
                  window.removeEventListener("keydown", escape);
                  setGhost(undefined);
                  if (commit)
                    add("resize", identity, "Resize this element", { original, requested });
                };
                const up = () => finish(true);
                const cancel = () => finish(false);
                const escape = (e: KeyboardEvent) => {
                  if (e.key === "Escape") finish(false);
                };
                handle.addEventListener("pointermove", move);
                handle.addEventListener("pointerup", up);
                handle.addEventListener("pointercancel", cancel);
                window.addEventListener("keydown", escape);
              }}
            >
              ↘
            </button>
          </>
        )}
        {ghost && (
          <div
            className="ghost"
            style={{ left: ghost.x, top: ghost.y, width: ghost.width, height: ghost.height }}
          />
        )}
        <div className="toolbar">
          <strong style={{ padding: 7 }}>Edit mode</strong>
          {hidden ? (
            <button onClick={() => setHidden(false)}>Show</button>
          ) : (
            <>
              <button
                onClick={() => {
                  setReview(false);
                  openComment();
                }}
              >
                💬 General comment
              </button>
              <button
                onClick={() => {
                  setPicker(true);
                  setReview(false);
                }}
              >
                Pick element
              </button>
              <button
                onClick={() => {
                  setReview(true);
                  setEditor(undefined);
                  setPicker(false);
                }}
              >
                Review changes ({store.requests.length})
              </button>
              <button onClick={() => setHidden(true)}>Hide</button>
            </>
          )}
        </div>
        {!hidden && !review && !editor && !picker && store.requests.length === 0 && (
          <div className="panel" style={{ width: 280 }}>
            <h2>Mark up this page</h2>
            <p>
              Hover an element to comment, mark removal, or resize. The app still works normally.
            </p>
            <small>Proposals only. Review and send them in chat before changes are applied.</small>
            <small>Embedded pages and closed shadow content aren’t supported.</small>
            {!storageAvailable && (
              <p className="notice">
                Storage unavailable. Copy your feedback before leaving this page.
              </p>
            )}
          </div>
        )}
        {!hidden && picker && (
          <div className="panel">
            <h2>Pick an element</h2>
            <select
              size={12}
              aria-label="Page elements"
              onChange={(event) => {
                const el = candidates[Number(event.target.value)];
                if (el) {
                  setTarget(el);
                  setPicker(false);
                }
              }}
              defaultValue=""
            >
              <option value="" disabled>
                Choose an element
              </option>
              {candidates.map((el, index) => (
                <option key={index} value={index}>
                  {el.tagName.toLowerCase()}: {label(el) || "(unlabelled)"}
                </option>
              ))}
            </select>
            <div className="actions">
              <button onClick={() => setPicker(false)}>Cancel</button>
            </div>
          </div>
        )}
        {!hidden && editor && (
          <div className="panel">
            <h2>
              {editor.resize
                ? "Requested size"
                : editor.target
                  ? "Element comment"
                  : "General comment"}
            </h2>
            <small>{editor.target?.label}</small>
            {editor.resize ? (
              <>
                <label>
                  Width{" "}
                  <input
                    type="number"
                    min="20"
                    value={width}
                    onChange={(e) => setWidth(Number(e.target.value))}
                  />
                </label>
                <label>
                  Height{" "}
                  <input
                    type="number"
                    min="20"
                    value={height}
                    onChange={(e) => setHeight(Number(e.target.value))}
                  />
                </label>
              </>
            ) : (
              <textarea
                autoFocus
                aria-label="Feedback"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            )}
            <div className="actions">
              <button
                disabled={
                  editor.resize
                    ? !Number.isFinite(width + height) || width < 20 || height < 20
                    : !text.trim()
                }
                onClick={() => {
                  if (editor.resize) {
                    const el = resolve(editor.target);
                    if (!el) {
                      setMessage("Target changed. Pick it again.");
                      return;
                    }
                    const b = el.getBoundingClientRect();
                    add("resize", editor.target, "Resize this element", {
                      original: { width: Math.round(b.width), height: Math.round(b.height) },
                      requested: { width, height },
                    });
                  } else if (editor.id)
                    change(store.requests.map((r) => (r.id === editor.id ? { ...r, text } : r)));
                  else add("comment", editor.target, text);
                  setEditor(undefined);
                }}
              >
                Save request
              </button>
              <button onClick={() => setEditor(undefined)}>Cancel</button>
            </div>
            <p role="status">{message}</p>
          </div>
        )}
        {!hidden && review && !editor && (
          <div className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
              <h2>Review changes</h2>
              <button aria-label="Close review changes" onClick={() => setReview(false)}>×</button>
            </div>
            <small>Choose feedback to send. Exporting does not approve product edits.</small>
            {!storageAvailable && (
              <p className="notice">Drafts are in memory only. Copy before navigating.</p>
            )}
            {store.requests.map((r) => (
              <div className="row" key={r.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={r.selected}
                    onChange={(e) =>
                      change(
                        store.requests.map((item) =>
                          item.id === r.id ? { ...item, selected: e.target.checked } : item,
                        ),
                      )
                    }
                  />
                  <span>
                    {r.kind}: {r.text}
                  </span>
                </label>
                <small>
                  {r.path} · {r.target?.label || "Whole page"}
                </small>
                {r.target && (
                  <small>
                    {r.path !== location.pathname
                      ? "On another page"
                      : resolve(r.target)
                        ? "Target found"
                        : "Target missing or changed — needs review"}
                  </small>
                )}
                {r.requested && (
                  <p>
                    {r.original?.width} × {r.original?.height} → {r.requested.width} ×{" "}
                    {r.requested.height}px
                  </p>
                )}
                {r.target &&
                  store.requests.some(
                    (other) =>
                      other.id !== r.id &&
                      other.path === r.path &&
                      same(other.target, r.target) &&
                      [other.kind, r.kind].includes("delete") &&
                      [other.kind, r.kind].includes("resize"),
                  ) && (
                    <p className="notice">
                      Conflict: removal and resizing target the same element.
                    </p>
                  )}
                <div className="actions">
                  <button onClick={() => openComment(r.target, r.id)}>Edit wording</button>
                  <button onClick={() => undo(r)}>Undo</button>
                </div>
              </div>
            ))}
            <div className="actions">
              <button
                onClick={() => {
                  setReview(false);
                  setMessage("");
                }}
              >
                Return to collection
              </button>
              <button
                disabled={
                  !store.requests.some((r) => r.selected) ||
                  store.submitted?.revision === store.revision
                }
                onClick={exportReport}
              >
                Prepare selected report
              </button>
            </div>
            {report && (
              <>
                <p role="status">{message}</p>
                <textarea
                  aria-label="Selected feedback report"
                  readOnly
                  value={report}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <div className="actions">
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(report);
                        setMessage(
                          "Copied. Paste into chat for concrete proposals and confirmation.",
                        );
                      } catch {
                        setMessage(
                          "Copy unavailable. Select the report text and copy it manually.",
                        );
                      }
                    }}
                  >
                    Copy report
                  </button>
                  <button
                    onClick={() => {
                      const url = URL.createObjectURL(
                        new Blob([report], { type: "application/json" }),
                      );
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = "forgettime-feedback.json";
                      link.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Download
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </>
    );
  }
}

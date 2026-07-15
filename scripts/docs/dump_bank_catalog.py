from __future__ import annotations

import asyncio
import html
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

os.environ.setdefault("ALLOW_MISSING_FRONTEND", "true")

from source.backend.helpers import (  # noqa: E402
    get_frontend_source_path,
    get_project_description,
    get_project_name,
    get_project_repository,
)
from source.backend.services.banking import enable_banking_catalog  # noqa: E402
from source.backend.services.banking.bank_catalog import get_catalog  # noqa: E402
from source.backend.services.banking.bank_info_updater import (  # noqa: E402
    add_bank_info_overrides_to_db,
)


def _provider_notes() -> dict[str, dict[str, str]]:
    locale = get_frontend_source_path() / "i18n" / "locales" / "en.json"
    try:
        banks = json.loads(locale.read_text(encoding="utf-8")).get("banks", {})
    except OSError:
        return {}
    return {key: value for key, value in banks.items() if isinstance(value, dict) and "title" in value}


def _prepare(entry: dict, notes: dict[str, dict[str, str]]) -> dict:
    icon = entry["icon"]
    meta = notes.get(entry["provider"], {})
    return {
        "provider": entry["provider"],
        "name": meta.get("title") if entry["provider"] == entry["key"] else entry["name"],
        "raw_name": entry["name"],
        "bic": entry["bic"],
        "icon": icon.lstrip("/") if icon else None,
        "tested": entry["tested"],
        "countries": list(entry["countries"]),
        "blzs": entry["blzs"],
        "fields": entry["required_fields"],
        "note": meta.get("note"),
    }


def build_html(entries: list[dict]) -> str:
    notes = _provider_notes()
    prepared = sorted(
        (_prepare(entry, notes) for entry in entries),
        key=lambda item: (item["name"] or item["raw_name"]).lower(),
    )
    data = json.dumps(prepared, ensure_ascii=False).replace("</", "<\\/")
    return _TEMPLATE.format(
        data=data,
        name=html.escape(get_project_name()),
        description=html.escape(get_project_description()),
        repo=html.escape(get_project_repository()),
    )


_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Supported banks of {name}</title>
<link rel="icon" type="image/png" href="favicon.png">
<style>
  :root {{
    --bg: #1e1e1e; --card: #262626; --muted: #2e2e2e; --fg: #f5f5f5;
    --dim: #a3a3a3; --primary: #03ecfc; --border: #383838; --ok: #34d399;
  }}
  @media (prefers-color-scheme: light) {{
    :root {{
      --bg: #f7f7f8; --card: #ffffff; --muted: #ececed; --fg: #1e1e1e;
      --dim: #6b7280; --primary: #009eff; --border: #e2e2e5; --ok: #059669;
    }}
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; background: var(--bg); color: var(--fg);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }}
  header {{
    padding: 2.5rem 1.5rem 1.5rem; max-width: 1100px; margin: 0 auto;
  }}
  h1 {{ margin: 0 0 .25rem; font-size: 1.9rem; letter-spacing: -.02em; }}
  h1 span {{ color: var(--primary); }}
  .tagline {{ color: var(--fg); margin: 0 0 .5rem; }}
  .sub {{ color: var(--dim); margin: 0; }}
  .sub a {{ color: var(--primary); text-decoration: none; }}
  .sub a:hover {{ text-decoration: underline; }}
  .controls {{
    position: sticky; top: 0; z-index: 5; background: var(--bg);
    padding: 1rem 1.5rem; max-width: 1100px; margin: 0 auto;
    border-bottom: 1px solid var(--border);
  }}
  input[type=search] {{
    width: 100%; padding: .7rem .9rem; font-size: 1rem; color: var(--fg);
    background: var(--card); border: 1px solid var(--border); border-radius: 10px;
  }}
  input[type=search]:focus {{ outline: 2px solid var(--primary); border-color: transparent; }}
  main {{ max-width: 1100px; margin: 0 auto; padding: 1.5rem; }}
  #count {{ color: var(--dim); margin: 0 0 1rem; font-size: .9rem; }}
  .grid {{
    display: grid; gap: .9rem;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  }}
  .bank {{
    background: var(--card); border: 1px solid var(--border); border-radius: 14px;
    padding: 1rem; display: flex; flex-direction: column; gap: .6rem;
  }}
  .bank-head {{ display: flex; align-items: center; gap: .75rem; }}
  .logo, .mono {{
    width: 40px; height: 40px; border-radius: 9px; flex: 0 0 40px;
    object-fit: contain; background: var(--muted);
  }}
  .mono {{
    display: grid; place-items: center; font-weight: 700; color: var(--primary);
    font-size: 1.05rem;
  }}
  .bank-name {{ font-weight: 600; line-height: 1.25; }}
  .badges {{ display: flex; flex-wrap: wrap; gap: .4rem; }}
  .badge {{
    font-size: .72rem; padding: .15rem .5rem; border-radius: 6px;
    background: var(--muted); color: var(--dim);
  }}
  .badge.ok {{ background: color-mix(in srgb, var(--ok) 22%, transparent); color: var(--ok); }}
  .meta {{ font-size: .8rem; color: var(--dim); }}
  .meta code {{
    background: var(--muted); padding: .05rem .35rem; border-radius: 4px;
    font-size: .9em; color: var(--fg);
  }}
  .note {{ font-size: .8rem; color: var(--dim); border-top: 1px solid var(--border); padding-top: .5rem; }}
  .empty {{ text-align: center; color: var(--dim); padding: 3rem; }}
</style>
</head>
<body>
<header>
  <h1>Supported banks of <span>{name}</span></h1>
  <p class="tagline">{description}</p>
  <p class="sub">
    <a href="./index.html">API docs</a> &middot;
    <a href="{repo}">GitHub</a>
  </p>
</header>
<div class="controls">
  <input type="search" id="q" placeholder="Search by name, BIC or sort code (BLZ)…" autocomplete="off">
</div>
<main>
  <p id="count"></p>
  <div class="grid" id="grid"></div>
  <div class="empty" id="empty" hidden>No bank matches your filters.</div>
</main>
<script>
  const BANKS = {data};
  const HANDLERS = {{ fints: "FinTS", enable_banking: "Enable Banking" }};
  let query = "";

  function initials(name) {{
    return (name || "?").replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\\s+/)
      .slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
  }}

  function matches(b) {{
    if (!query) return true;
    if ((b.name || "").toLowerCase().includes(query)) return true;
    if ((b.raw_name || "").toLowerCase().includes(query)) return true;
    if ((b.bic || "").toLowerCase().includes(query)) return true;
    return b.blzs.some(blz => blz.includes(query));
  }}

  function card(b) {{
    const el = document.createElement("article");
    el.className = "bank";
    const logo = b.icon
      ? `<img class="logo" src="${{b.icon}}" alt="" loading="lazy">`
      : `<div class="mono">${{initials(b.name || b.raw_name)}}</div>`;
    const badges = [];
    if (b.tested) badges.push('<span class="badge ok">Tested</span>');
    badges.push(`<span class="badge">${{HANDLERS[b.provider] || b.provider}}</span>`);
    if (b.blzs.length > 1) badges.push(`<span class="badge">${{b.blzs.length}} sort codes</span>`);
    const bic = b.bic ? `<div class="meta">BIC <code>${{b.bic}}</code></div>` : "";
    const blz = b.blzs.length
      ? `<div class="meta">BLZ <code>${{b.blzs[0]}}</code>${{b.blzs.length > 1 ? " …" : ""}}</div>`
      : "";
    const countries = b.countries && b.countries.length
      ? `<div class="meta">${{b.countries.join(", ")}}</div>`
      : "";
    const note = b.note ? `<div class="note">${{b.note}}</div>` : "";
    el.innerHTML = `
      <div class="bank-head">
        ${{logo}}
        <div>
          <div class="bank-name">${{b.name || b.raw_name}}</div>
        </div>
      </div>
      <div class="badges">${{badges.join("")}}</div>
      ${{bic}}${{blz}}${{countries}}${{note}}`;
    return el;
  }}

  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
  const count = document.getElementById("count");

  function render() {{
    const shown = BANKS.filter(matches);
    grid.replaceChildren(...shown.map(card));
    empty.hidden = shown.length > 0;
    count.textContent = `Showing ${{shown.length}} of ${{BANKS.length}} banks`;
  }}

  document.getElementById("q").addEventListener("input", e => {{
    query = e.target.value.trim().toLowerCase();
    render();
  }});

  render();
</script>
</body>
</html>
"""


def main() -> None:
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "banks.html"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    add_bank_info_overrides_to_db()
    asyncio.run(enable_banking_catalog.run_startup_update())
    entries = get_catalog()
    out_path.write_text(build_html(entries), encoding="utf-8")
    print(f"Wrote bank catalog page ({len(entries)} banks) to {out_path}")


if __name__ == "__main__":
    main()

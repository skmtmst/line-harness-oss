import { readFileSync } from "node:fs";
import { escapeHtml as e } from "./shared.mjs";
import { feats, faqData, tourData } from "./content.mjs";

// Markup of the top page (Claude Design handoff "musubo Top Page"), with placeholders.
const template = readFileSync(new URL("./home.html", import.meta.url), "utf8");

const pad2 = (n) => String(n).padStart(2, "0");

function featureCards() {
  return feats
    .map((f) => {
      const i = f.title.indexOf("、");
      const t1 = i > 0 ? f.title.slice(0, i + 1) : f.title;
      const t2 = i > 0 ? f.title.slice(i + 1) : "";
      return `<article class="feature"><div class="kicker"><span class="no">${e(f.no)}</span><i></i><b>${e(f.label)}</b></div><h3 class="title"><span class="ib">${e(t1)}</span><span class="ib">${e(t2)}</span></h3><p>${e(f.body)}</p>${f.note ? `<div class="fnote">${e(f.note)}</div>` : ""}<div class="tags"><span>${e(f.tag1)}</span><span>${e(f.tag2)}</span></div></article>`;
    })
    .join("");
}

// Native <details>: readable and operable without JavaScript.
function faqItems() {
  return faqData
    .map(
      ([q, a], i) =>
        `<details class="faq-item"><summary class="faq-q"><span class="no">${pad2(i + 1)}</span><span class="q">${e(q)}</span><span class="pm" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="#0F6B44" stroke-width="1.6" stroke-linecap="round"/></svg></span></summary><div class="faq-a">${e(a)}</div></details>`,
    )
    .join("");
}

// The tour is a sample-screen mock drawn by /assets/site.js. Its data travels as inert JSON
// (not executed, so it stays within script-src 'self').
const tourJson = () => JSON.stringify(tourData).replace(/</g, "\\u003c");

export function home(config, production) {
  const app = production ? config.productionAppOrigin : config.stagingAppOrigin;
  return template
    .replaceAll("{{APP}}", e(app))
    .replace("{{FEATURES}}", featureCards())
    .replace("{{FAQ}}", faqItems())
    .replace("{{TOUR}}", tourJson());
}

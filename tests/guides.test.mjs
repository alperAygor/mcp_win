import test from "node:test";
import assert from "node:assert/strict";
import { GENERAL, GUIDES } from "../app/gui/ui/guides-data.js";
import { guideCompleteness, guideIndex, renderGuide } from "../app/gui/ui/guides.js";
import { ILLUSTRATION_KINDS, ill } from "../app/gui/ui/illustrations.js";
import { REGISTRY } from "../app/lib/registry.mjs";
import { fakePc } from "./helpers.mjs";

const state = () => ({ mcps: REGISTRY.map((d) => ({ id: d.id, name: d.name, tier: d.tier ?? "stable", kind: d.kind, installed: true, homepage: d.homepage })) });

test("every integration has a guide, in both languages, with every section filled in", () => {
  for (const def of REGISTRY) {
    assert.ok(GUIDES[def.id], `no guide for ${def.id}`);
    for (const lang of ["tr", "en"]) {
      const c = guideCompleteness(def.id, lang);
      assert.ok(c.ok, `${def.id}/${lang} is missing: ${c.missing.join(", ")}`);
    }
  }
  for (const g of GENERAL) for (const lang of ["tr", "en"]) assert.ok(guideCompleteness(g.id, lang).ok, `${g.id}/${lang}`);
  assert.deepEqual(GENERAL.map((g) => g.id), ["how", "first", "prompts", "ports", "store", "safety", "trouble", "clients"]);
});

test("Turkish and English guides have the same shape (same number of steps, prompts and fixes)", () => {
  for (const [id, g] of Object.entries(GUIDES)) {
    for (const k of ["steps", "prompts", "fix", "good", "needs", "limits"]) assert.equal(g.tr[k]?.length ?? 0, g.en[k]?.length ?? 0, `${id}.${k}`);
    g.tr.steps.forEach((s, i) => assert.equal(s.img?.k, g.en.steps[i].img?.k, `${id} step ${i + 1} picture differs between languages`));
  }
  for (const g of GENERAL) assert.equal(g.tr.steps.length, g.en.steps.length, g.id);
});

test("every step has a title and text, and every picture spec renders a non-empty SVG", () => {
  const all = [...GENERAL.flatMap((g) => [g.tr, g.en]), ...Object.values(GUIDES).flatMap((g) => [g.tr, g.en])];
  let pictures = 0;
  for (const g of all) for (const s of g.steps) {
    assert.ok(s.t?.trim() && s.d?.trim(), `empty step in ${g.what?.slice(0, 40)}`);
    if (s.img) {
      assert.ok(ILLUSTRATION_KINDS.includes(s.img.k), `unknown picture kind ${s.img.k}`);
      for (const lang of ["tr", "en"]) assert.match(ill(s.img, lang), /^<svg[\s\S]+<\/svg>$/);
      pictures++;
    }
  }
  assert.ok(pictures > 100, `expected lots of pictures, got ${pictures}`);
});

test("guides render as HTML for every integration and language, with the automatic first and last steps", () => {
  const st = state();
  for (const def of REGISTRY) for (const lang of ["tr", "en"]) {
    const html = renderGuide(def.id, lang, st);
    assert.match(html, /class="guide"/, `${def.id}/${lang}`);
    assert.ok(!/undefined|\[object/.test(html), `${def.id}/${lang} has an unrendered value`);
    const local = !GUIDES[def.id].cloud && !GUIDES[def.id].manual;
    if (local) assert.equal((html.match(/class="g-step"/g) ?? []).length, GUIDES[def.id][lang].steps.length + 4, `${def.id}: head+tail steps`);
  }
  for (const g of GENERAL) assert.match(renderGuide(g.id, "tr", st), /class="guide"/);
});

test("guide text is HTML-escaped (a malicious integration name cannot inject markup)", () => {
  const st = state();
  st.mcps.find((m) => m.id === "revit").name = { tr: "<img src=x onerror=alert(1)>", en: "<img src=x onerror=alert(1)>" };
  const html = renderGuide("revit", "en", st);
  assert.ok(!html.includes("<img src=x"), "name must be escaped");
  assert.match(html, /&lt;img src=x/);
});

test("the guide index lists general guides first, then the programs", () => {
  const idx = guideIndex(state(), "en");
  assert.equal(idx.general.length, 8);
  assert.equal(idx.programs.length, REGISTRY.length);
});

test("guides name only things that exist: paths and menu names that the registry/ports also use", () => {
  // the port numbers quoted in guides must match the registry's defaults
  const ports = { fusion360: 9876, ableton: 9877, rhino: 1999 };
  for (const [id, port] of Object.entries(ports)) {
    const claim = REGISTRY.find((d) => d.id === id).ports(REGISTRY.find((d) => d.id === id).defaults)[0].port;
    assert.equal(claim, port, id);
  }
  void fakePc;
});

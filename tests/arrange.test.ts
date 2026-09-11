import { test } from "node:test";
import assert from "node:assert/strict";
import { arrangeByFlow } from "../src/runtime/arrange";
import { DocumentSchema, type CanvasDocument } from "../src/shared/model";

function document(specs: { key: string; links?: string[]; source?: string; x?: number; y?: number }[]): CanvasDocument {
  const screens = Object.fromEntries(specs.map((spec, index) => [`screen-${index}`, {
    id: `screen-${index}`, key: spec.key, name: spec.key, source: spec.source ?? `screens/${spec.key}.tsx`, exportName: "default",
    x: spec.x ?? 0, y: spec.y ?? 0, width: 402, height: 874, props: {}, notes: "", links: spec.links ?? [],
  }]));
  return DocumentSchema.parse({ name: "Flow", screenIds: Object.keys(screens), screens });
}

test("arrange by flow builds rows by depth from the entry, orders columns by parents and parks variants under their base", () => {
  const doc = document([
    { key: "workouts", links: ["plan"] },
    { key: "today", links: ["workout", "settings", "progress"] },
    { key: "intro", links: ["today"] },
    { key: "plan", links: ["workout"] },
    { key: "workout", links: ["progress"] },
    { key: "settings", links: ["legal"] },
    { key: "progress", links: [] },
    { key: "legal", links: [] },
    { key: "today-editorial", links: ["workout", "settings", "progress"], source: "screens/today.tsx" },
    { key: "today-morning", links: [], source: "screens/today.tsx" },
  ]);
  const moves = arrangeByFlow(doc);
  const position = Object.fromEntries(moves.map((move) => [doc.screens[move.id].key, move.patch]));
  const at = (key: string) => position[key] ?? doc.screens[Object.keys(doc.screens).find((id) => doc.screens[id].key === key)!];
  assert.ok(at("intro").y < at("today").y && at("today").y < at("workout").y && at("workout").y < at("legal").y, "depth grows top to bottom");
  assert.equal(at("intro").y, 0, "the entry is the unlinked screen that reaches the most of the app, not the first in document order");
  assert.equal(at("workouts").y, at("today").y, "an unlinked top-level screen sits beside the entry's children");
  assert.equal(at("plan").y, at("workout").y, "plan opens from workouts, one row further");
  assert.equal(at("progress").y, at("workout").y, "the shortest path decides the row");
  assert.equal(at("settings").y, at("workout").y);
  const row2 = ["workout", "settings", "progress", "plan"].map((key) => at(key).x);
  assert.equal(new Set(row2).size, 4, "screens in one row take distinct columns");
  assert.equal(at("today-morning").x, at("today").x, "a variant sits under the screen it varies");
  const mainBottom = Math.max(...["intro", "today", "workouts", "plan", "workout", "settings", "progress", "legal"].map((key) => at(key).y));
  assert.ok(at("today-morning").y > mainBottom, "variants form a band under the main flow");
  assert.equal(at("today-editorial").x, at("today").x, "a linking screen that nothing links to is still a variant of its base");
  assert.notEqual(at("today-editorial").y, at("today-morning").y, "variants of one base stack without overlapping");
  assert.deepEqual(arrangeByFlow({ ...doc, screens: Object.fromEntries(Object.entries(doc.screens).map(([id, screen]) => [id, { ...screen, ...(position[screen.key] ?? {}) }])) }), [], "an arranged document yields no moves");
});

test('native scene families wrap without overlapping destinations and preserve deterministic layout',()=>{
  const doc=document([{key:'root',links:['state-0']},...Array.from({length:8},(_,i)=>({key:`state-${i}`,links:i===7?['detail']:[]})),{key:'detail'}]);
  for(let i=0;i<8;i++) doc.screens[`screen-${i+1}`].props={native:{scene:{id:'Root.page',index:i}}};
  for(const move of arrangeByFlow(doc)) Object.assign(doc.screens[move.id],move.patch);
  assert.equal(doc.screens['screen-1'].y,doc.screens['screen-6'].y);
  assert.ok(doc.screens['screen-7'].y>doc.screens['screen-1'].y);
  const screens=Object.values(doc.screens);
  for(let i=0;i<screens.length;i++) for(const b of screens.slice(i+1)) {
    const a=screens[i];assert.ok(a.x+a.width<=b.x || b.x+b.width<=a.x || a.y+a.height<=b.y || b.y+b.height<=a.y);
  }
  assert.deepEqual(arrangeByFlow(doc),[]);
});

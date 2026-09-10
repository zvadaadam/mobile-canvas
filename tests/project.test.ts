import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  symlink,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/runtime/project";
import { CommandSchema, identityOf } from "../src/shared/model";
const code =
  'import {Text} from "react-native"; export default function Screen(){return <Text>Hello</Text>}';
async function fixture(t: any) {
  const path = await mkdtemp(join(tmpdir(), "expo-canvas-test-"));
  const store = await ProjectStore.initialize(path, "Test");
  t.after(async () => {
    await store.close();
    await rm(path, { recursive: true, force: true });
  });
  return { store, path };
}
const command = (
  store: ProjectStore,
  operations: unknown[],
  requestId = crypto.randomUUID(),
) =>
  CommandSchema.parse({
    ...identityOf(store.session()),
    requestId,
    label: "Test transaction",
    operations,
  });
const create = {
  type: "screen.create",
  screen: { key: "home", name: "Home", code },
};

test("source and screen creation is one idempotent undoable transaction", async (t) => {
  const { store, path } = await fixture(t);
  const input = command(store, [create]);
  const result = await store.execute(input);
  const id = result.created.home;
  assert.equal(
    result.session.project.document.screens[id].source,
    "screens/home.tsx",
  );
  assert.equal(await readFile(join(path, "screens/home.tsx"), "utf8"), code);
  assert.deepEqual(await store.execute(input), result);
  assert.equal(store.session().project.sequence, 1);
  await store.history("undo", identityOf(store.session()));
  assert.equal(store.session().project.document.screenIds.length, 0);
  await assert.rejects(readFile(join(path, "screens/home.tsx")));
  await store.history("redo", identityOf(store.session()));
  assert.equal(store.session().project.document.screenIds[0], id);
});
test("concurrent edits reject stale project identity without losing either source", async (t) => {
  const { store } = await fixture(t);
  const first = command(store, [create]);
  const second = command(store, [
    { ...create, screen: { key: "other", name: "Other", code } },
  ]);
  const results = await Promise.allSettled([
    store.execute(first),
    store.execute(second),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(store.session().project.sequence, 1);
  await assert.rejects(
    store.execute({
      ...first,
      requestId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
    }),
    /canvas changed/i,
  );
});
test("moving a fixture preserves its context, props, dimensions and export through validation and undo", async (t) => {
  const { store } = await fixture(t);
  const result = await store.execute(
    command(store, [
      {
        type: "screen.create",
        screen: {
          key: "home",
          name: "Home",
          code: code.replace(
            "export default function Screen",
            "export function Fixture",
          ),
          exportName: "Fixture",
          width: 393,
          height: 852,
          props: { variant: "evening", reminders: false },
          notes:
            "Purpose: plan tomorrow. States: reminders off. Tap: opens detail.",
          links: ["detail"],
        },
      },
    ]),
  );
  const id = result.created.home;
  const before = store.session();
  const patch = command(store, [
    { type: "screen.update", id, patch: { x: 120, y: 80 } },
  ]);
  assert.deepEqual((patch.operations[0] as any).patch, { x: 120, y: 80 });
  await store.execute(patch);
  assert.deepEqual(store.session().project.document.screens[id], {
    ...before.project.document.screens[id],
    x: 120,
    y: 80,
  });
  assert.equal(store.session().codeVersion, before.codeVersion);
  await store.history("undo", identityOf(store.session()));
  assert.deepEqual(
    store.session().project.document.screens[id],
    before.project.document.screens[id],
  );
});
test("invalid batch is atomic; traversal, syntax and duplicate keys do not leave files", async (t) => {
  const { store, path } = await fixture(t);
  await assert.rejects(
    store.execute(command(store, [create, create])),
    /already uses/,
  );
  assert.equal(store.session().project.sequence, 0);
  await assert.rejects(readFile(join(path, "screens/home.tsx")));
  assert.throws(() =>
    command(store, [
      {
        type: "source.write",
        path: "screens/../../escape.tsx",
        code,
        expectedHash: null,
      },
    ]),
  );
  await assert.rejects(
    store.execute(
      command(store, [
        {
          ...create,
          screen: { ...create.screen, code: "export default function ( {" },
        },
      ]),
    ),
    /screens\/home\.tsx:1:\d+:/,
  );
});
test("external source edits invalidate hashes and cannot be overwritten by undo", async (t) => {
  const { store, path } = await fixture(t);
  await store.execute(command(store, [create]));
  const source = await store.readSource("screens/home.tsx");
  await writeFile(join(path, source.path), code.replace("Hello", "External"));
  await assert.rejects(
    store.execute(
      command(store, [
        {
          type: "source.write",
          path: source.path,
          code,
          expectedHash: source.hash,
        },
      ]),
    ),
    /changed/,
  );
  await assert.rejects(
    store.history("undo", identityOf(store.session())),
    /edited outside/,
  );
});
test("source watcher updates the generated registry and freshness without changing geometry history", async (t) => {
  const { store, path } = await fixture(t);
  await store.execute(command(store, [create]));
  const before = store.session();
  const changed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Source watch timed out")),
      8000,
    );
    const stop = store.subscribe(() => {
      clearTimeout(timer);
      stop();
      resolve();
    });
  });
  await writeFile(
    join(path, "screens/home.tsx"),
    code.replace("Hello", "Updated"),
  );
  await changed;
  assert.notEqual(store.session().codeVersion, before.codeVersion);
  assert.equal(store.session().project.sequence, before.project.sequence);
  assert.match(
    await readFile(join(path, ".expo-canvas/registry.ts"), "utf8"),
    new RegExp(store.session().codeVersion),
  );
});
test("projects reopen with the same IDs and recover an interrupted multi-file commit", async (t) => {
  const { store, path } = await fixture(t);
  await store.execute(command(store, [create]));
  const project = store.session().project;
  await store.close();
  project.sequence++;
  project.document.name = "Recovered";
  await writeFile(
    join(path, ".expo-canvas/pending.json"),
    JSON.stringify({
      project,
      files: { "screens/home.tsx": code.replace("Hello", "Recovered") },
    }),
  );
  const reopened = await ProjectStore.open(path);
  t.after(() => reopened.close());
  assert.equal(reopened.session().project.document.name, "Recovered");
  assert.equal(
    reopened.session().project.document.screenIds[0],
    project.document.screenIds[0],
  );
  assert.match(
    (await reopened.readSource("screens/home.tsx")).code,
    /Recovered/,
  );
  await assert.rejects(readFile(join(path, ".expo-canvas/pending.json")));
});
test("source operations cannot traverse project symlinks", async (t) => {
  const { store, path } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), "expo-canvas-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(path, "screens/linked"));
  await assert.rejects(
    store.execute(
      command(store, [
        {
          type: "source.write",
          path: "screens/linked/escape.tsx",
          code,
          expectedHash: null,
        },
      ]),
    ),
    /symlink/,
  );
  await assert.rejects(readFile(join(outside, "escape.tsx")));
});
test("screen positions and context do not make captures stale; fixture props do", async (t) => {
  const { store } = await fixture(t);
  const result = await store.execute(command(store, [create]));
  const id = result.created.home,
    version = store.session().codeVersion;
  await store.execute(
    command(store, [{ type: "screen.update", id, patch: { x: 420, y: 100 } }]),
  );
  assert.equal(store.session().codeVersion, version);
  await store.execute(command(store, [{
    type: "screen.update", id,
    patch: { notes: "Purpose: choose a routine. Interaction: opens detail.", links: ["detail"] },
  }]));
  assert.equal(store.session().codeVersion, version);
  await store.execute(
    command(store, [
      { type: "screen.update", id, patch: { props: { enabled: false } } },
    ]),
  );
  assert.notEqual(store.session().codeVersion, version);
});

test("source byte and file-count limits fail before changing the project", async (t) => {
  const { store, path } = await fixture(t);
  const initial = await readFile(join(path, "expo-canvas.json"), "utf8");
  await assert.rejects(
    store.execute(
      command(store, [
        {
          ...create,
          screen: {
            key: "home",
            name: "Home",
            code: "//" + "😀".repeat(30_000),
          },
        },
      ]),
    ),
    /100 KB/,
  );
  await assert.rejects(readFile(join(path, "screens/home.tsx")));
  await Promise.all(
    Array.from({ length: 256 }, (_, index) =>
      writeFile(
        join(path, `lib/source-${index}.ts`),
        "export const value = 1;",
      ),
    ),
  );
  await assert.rejects(
    store.execute(command(store, [create])),
    /256 source files/,
  );
  assert.equal(await readFile(join(path, "expo-canvas.json"), "utf8"), initial);
  await assert.rejects(readFile(join(path, "screens/home.tsx")));
  await assert.rejects(readFile(join(path, ".expo-canvas/pending.json")));
});

test("invalid recovery journal fails before replaying any source", async (t) => {
  const { store, path } = await fixture(t);
  await store.execute(command(store, [create]));
  await store.close();
  const project = store.session().project;
  await writeFile(
    join(path, ".expo-canvas/pending.json"),
    JSON.stringify({
      project,
      files: {
        "screens/home.tsx": code.replace("Hello", "Changed"),
        "lib/broken.ts": 42,
      },
    }),
  );
  await assert.rejects(ProjectStore.open(path));
  assert.equal(await readFile(join(path, "screens/home.tsx"), "utf8"), code);
});

import { build } from "esbuild";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const directory = dirname(fileURLToPath(import.meta.url));
const result = await build({
  absWorkingDir: directory,
  entryPoints: ["app.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
  metafile: true,
  legalComments: "eof",
});
const script = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const style = await readFile(join(directory, "style.css"), "utf8");
const html = (await readFile(join(directory, "index.html"), "utf8"))
  .replace("/* CANVAS_STYLE */", () => style)
  .replace("/* CANVAS_SCRIPT */", () => script);
const notices = new Map();
for (const input of Object.keys(result.metafile.inputs).filter((path) =>
  path.includes("node_modules/"),
)) {
  let owner = dirname(resolve(directory, input));
  while (owner !== dirname(owner)) {
    const manifest = await readFile(join(owner, "package.json"), "utf8").then(
      JSON.parse,
      () => null,
    );
    if (manifest?.name) {
      const key = `${manifest.name}@${manifest.version}`;
      if (!notices.has(key)) {
        const license = (await readdir(owner)).find((name) =>
          /^licen[sc]e(?:\.(?:md|txt))?$/i.test(name),
        );
        if (!license)
          throw new Error(`Bundled dependency ${key} has no license file.`);
        notices.set(key, await readFile(join(owner, license), "utf8"));
      }
      break;
    }
    owner = dirname(owner);
  }
}
await mkdir(join(directory, "dist"), { recursive: true });
await writeFile(join(directory, "dist/index.html"), html);
await writeFile(
  join(directory, "dist/THIRD_PARTY_NOTICES.txt"),
  [...notices]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, license]) => `${name}\n${license}`)
    .join("\n\n---\n\n"),
);
console.log(
  `MCP App: ${Buffer.byteLength(html)} bytes, ${notices.size} bundled dependency notices`,
);

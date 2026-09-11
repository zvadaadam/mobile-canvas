import { swiftInputFiles, loadSwiftProject, isSwiftInput } from "./adapters/swift/project";
import type { SwiftProject } from "../shared/native";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  unlink,
  watch,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import ts from "typescript";
import { z } from "zod";
import {
  CommandSchema,
  DocumentSchema,
  ProjectSchema,
  ResolverSchema,
  ScreenSchema,
  SourcePath,
  type CanvasDocument,
  type Command,
  type CommandResult,
  type Identity,
  type Origin,
  type Project,
  type Session,
} from "../shared/model";
import { ImportSchema, type ImportReport } from "../shared/import";
import { copyModules, planImport } from "./import";
import { readRegularFileBounded, writeFileAtomically } from "./atomic-file";
import { createMutex } from "./mutex";
import { projectPath } from "./paths";
import { CanvasError } from "./errors";
import { screenTemplate } from "./template";
import { arrangeByFlow } from "./arrange";
import { routeCard } from "./route-card";
import { routeContext, linkedRouteSource } from "./host/route-context";

export const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export interface ImportResult {
  session: Session;
  import: ImportReport;
}
type Files = Record<string, string | null>;
interface HistoryEntry {
  label: string;
  before: CanvasDocument;
  after: CanvasDocument;
  beforeFiles: Files;
  afterFiles: Files;
}
const manifest = "expo-canvas.json";
const sourceLimit = 256;
const journalSchema = z
  .object({
    project: ProjectSchema,
    files: z
      .record(SourcePath, z.string().max(100_000).nullable())
      .refine((files) => Object.keys(files).length <= sourceLimit),
  })
  .strict();

export class ProjectStore {
  private project!: Project;
  private files: Record<string, string> = {};
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private selection: string[] = [];
  private receipts = new Map<string, { hash: string; result: Promise<unknown>; settled: boolean }>();
  private mutex = createMutex();
  private listeners = new Set<() => void>();
  private watching = new AbortController();
  private codeVersion = "";
  private nativeVersion: string | undefined;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private constructor(readonly directory: string) {}

  static async initialize(directory: string, name: string, native?: { spec: SwiftProject; app: string }) {
    await mkdir(directory, { recursive: true });
    const store = new ProjectStore(await realpath(directory));
    const target = await projectPath(store.directory, manifest);
    try {
      await readFile(target);
      throw new CanvasError(
        "project_exists",
        "This directory already contains an Expo Canvas project",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeFileAtomically(
      target,
      JSON.stringify(
        ProjectSchema.parse({
          version: native ? 2 : 1,
          workspaceId: randomUUID(),
          sequence: 0,
          document: { name, screenIds: [], screens: {}, ...(native ? { nativePreview: native.spec, origin: { path: native.app, name, mode: "linked", root: "", commit: null, importedAt: Date.now(), files: {} } } : {}) },
        }),
        null,
        2,
      ) + "\n",
    );
    return ProjectStore.open(directory);
  }

  static async open(directory: string) {
    const store = new ProjectStore(await realpath(directory));
    await projectPath(store.directory, ".expo-canvas/pending.json", true);
    const pending = await store.readOptional(
      ".expo-canvas/pending.json",
      8_000_000,
    );
    if (pending) {
      const journal = journalSchema.parse(JSON.parse(pending));
      for (const [path, code] of Object.entries(journal.files)) {
        if (code !== null) store.validateCode(path, code);
        await projectPath(store.directory, path, true);
      }
      await store.writeJournal(journal.project, journal.files);
    }
    store.project = ProjectSchema.parse(
      JSON.parse(
        await readRegularFileBounded(
          await projectPath(store.directory, manifest),
          2_000_000,
        ).then(String),
      ),
    );
    await store.refreshSources();
    await store.writeRegistry();
    for (const sourceRoot of ["screens", "components", "lib"]) {
      await mkdir(
        await projectPath(store.directory, `${sourceRoot}/.keep`, true).then(
          dirname,
        ),
        { recursive: true },
      );
      void store.watchSources(join(store.directory, sourceRoot));
    }
    if (store.project.document.nativePreview && store.project.document.origin)
      void store.watchSources(store.project.document.origin.path, true);
    return store;
  }

  private async readOptional(
    path: string,
    maximum = 100_000,
  ): Promise<string | null> {
    try {
      return String(
        await readRegularFileBounded(
          await projectPath(this.directory, path),
          maximum,
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async refreshSources() {
    const files: Record<string, string> = {};
    const scan = async (folder: string) => {
      let entries;
      try {
        entries = await readdir(await projectPath(this.directory, folder), {
          withFileTypes: true,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      for (const entry of entries.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const path = `${folder}/${entry.name}`;
        if (entry.isSymbolicLink())
          throw new CanvasError(
            "invalid_path",
            `Source folder contains a symlink: ${path}`,
          );
        if (entry.isDirectory()) {
          await scan(path);
          continue;
        }
        if (!/\.(tsx?|swift)$/.test(entry.name)) continue;
        SourcePath.parse(path);
        if (Object.keys(files).length >= sourceLimit)
          throw new CanvasError(
            "source_limit",
            "A project supports at most 256 source files",
          );
        files[path] = (await this.readOptional(path))!;
      }
    };
    for (const folder of ["screens", "components", "lib"]) await scan(folder);
    this.files = files;
    const native = this.project.document.nativePreview;
    if (native && this.project.document.origin) {
      const inputs = await swiftInputFiles(this.project.document.origin.path, native, {allowMissing: true});
      this.nativeVersion = digest(JSON.stringify({ inputs: inputs.map(x => [x.path, digest(x.bytes)]), files, native, recipes: Object.values(this.project.document.screens).map(s => [(s.props.native as any)?.factory, (s.props.native as any)?.recipe]) }));
    }
    this.codeVersion = digest(
      JSON.stringify({
        files,
        nativeVersion: this.nativeVersion,
        resolver: this.project.document.resolver ?? null,
        appPreview: this.project.document.appPreview ?? null,
        screens: this.project.document.screenIds.map((id) => {
          const { x, y, notes, links, ...screen } =
            this.project.document.screens[id];
          return screen;
        }),
      }),
    );
  }

  private async watchSources(folder: string, nativeInputs = false) {
    try {
      for await (const event of watch(folder, {
        recursive: true,
        signal: this.watching.signal,
      })) {
        if (!event.filename) continue;
        const native = this.project.document.nativePreview;
        if (nativeInputs ? !native || !isSwiftInput(native, event.filename) : !/\.(tsx?|swift)$/.test(event.filename)) continue;
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(
          () =>
            void this.mutex
              .run(async () => {
                if (this.watching.signal.aborted) return;
                const previous = this.codeVersion;
                await this.refreshSources();
                await this.writeRegistry();
                if (previous !== this.codeVersion) this.emit();
              })
              .catch((error) =>
                console.error("Source refresh:", error.message),
              ),
          100,
        );
      }
    } catch (error) {
      if (!this.watching.signal.aborted)
        console.error("Source watcher:", error);
    }
  }

  private async writeRegistry() {
    if (this.project.document.nativePreview) return;
    const { appPreview, origin } = this.project.document;
    if (appPreview && origin?.mode === "linked") {
      const contents = await routeContext(origin.path, appPreview.routesDirectory);
      if (await this.readOptional(".expo-canvas/route-context.ts", 200_000) !== contents)
        await writeFileAtomically(await projectPath(this.directory, ".expo-canvas/route-context.ts", true), contents);
    }
    const screens = this.project.document.screenIds.map(
      (id) => this.project.document.screens[id],
    );
    const imports = screens
      .map(
        (screen, i) =>
          `import { ${screen.exportName === "default" ? "default" : screen.exportName} as Component${i} } from ${JSON.stringify("../" + screen.source)};`,
      )
      .join("\n");
    const entries = screens
      .map((screen, i) => {
        const { x, y, notes, links, ...metadata } = screen;
        return `{ ...${JSON.stringify(metadata)}, route: ${JSON.stringify("/screen/" + screen.id)}, Component: Component${i} }`;
      })
      .join(",\n");
    const contents = `// Generated by Expo Canvas. Edit the project manifest and source files.\n${imports}\nexport const codeVersion = ${JSON.stringify(this.codeVersion)};\nexport const screens = [${entries}];\n`;
    if (
      (await this.readOptional(".expo-canvas/registry.ts", 200_000)) !==
      contents
    )
      await writeFileAtomically(
        await projectPath(this.directory, ".expo-canvas/registry.ts", true),
        contents,
      );
  }

  session(): Session {
    return structuredClone({
      project: this.project,
      directory: this.directory,
      codeVersion: this.codeVersion,
      ...(this.nativeVersion ? { nativeVersion: this.nativeVersion } : {}),
      sources: Object.entries(this.files).map(([path, code]) => ({
        path,
        hash: digest(code),
      })),
      selection: this.selection,
      history: {
        canUndo: this.undoStack.length > 0,
        canRedo: this.redoStack.length > 0,
        undoLabel: this.undoStack.at(-1)?.label ?? null,
      },
    });
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit() {
    for (const listener of this.listeners) listener();
  }
  assertIdentity(identity: Identity) {
    if (
      identity.workspaceId !== this.project.workspaceId ||
      identity.sequence !== this.project.sequence
    )
      throw new CanvasError(
        "stale_project",
        "The canvas changed. Read it again before editing.",
        409,
      );
  }
  select(workspaceId: string, ids: string[]) {
    if (workspaceId !== this.project.workspaceId)
      throw new CanvasError(
        "stale_project",
        "This selection belongs to another project",
        409,
      );
    this.selection = [...new Set(ids)].filter(
      (id) => this.project.document.screens[id],
    );
    this.emit();
    return this.session();
  }
  async readSource(path: string) {
    SourcePath.parse(path);
    const code = await this.readOptional(path);
    if (code === null)
      throw new CanvasError(
        "source_missing",
        "Source file does not exist",
        404,
      );
    return { path, code, hash: digest(code) };
  }
  async readRouteSource(screenId: string) {
    const { origin, screens, resolver } = this.project.document;
    const screen = screens[screenId];
    if (screen && this.project.document.nativePreview && origin) {
      const native = screen.props.native as {file?: string} | undefined;
      if (!native?.file) throw new CanvasError("invalid_source", "This native entry has no original source.");
      if (!this.project.document.nativePreview.files.includes(native.file)) throw new CanvasError("invalid_source", "Unknown native source.");
      const override = this.project.document.nativePreview.overrides[native.file];
      if (override) return {screenId, appPath:native.file, origin:origin.path, overridden:true, ...await this.readSource(override)};
      const path = await projectPath(origin.path, native.file);
      const code = (await readRegularFileBounded(path, 1_000_000)).toString("utf8");
      return {screenId, appPath:native.file, origin:origin.path, overridden:false, path, code, hash:digest(code), suggestedOverride:`lib/${native.file}`};
    }
    const route = screen?.props.route;
    if (!screen || !origin || !route || typeof route !== "object" || Array.isArray(route) || typeof route.file !== "string" || !/\.[jt]sx?$/.test(route.file))
      throw new CanvasError("invalid_screen", "Choose an imported route from canvas_route_map.");
    const step = route.step && typeof route.step === 'object' && !Array.isArray(route.step) ? route.step : null;
    const appPath = typeof step?.file === 'string' ? step.file : route.file;
    if (!/\.[jt]sx?$/.test(appPath)) throw new CanvasError("invalid_source", "A route step must point to an app source file.");
    const override = resolver?.modules[appPath];
    if (override) return { screenId, appPath, routeEntry: route.file, origin: origin.path, overridden: true, ...await this.readSource(override) };
    const path = await projectPath(origin.path, appPath);
    const code = (await readRegularFileBounded(path, 100_000)).toString("utf8");
    return { screenId, appPath, routeEntry: route.file, origin: origin.path, overridden: false, path, code, hash: digest(code),
      previewSource: screen.source, suggestedOverride: `lib/${appPath}` };
  }

  private validateCode(path: string, code: string) {
    if (Buffer.byteLength(code, "utf8") > 100_000)
      throw new CanvasError(
        "source_limit",
        "A source file supports at most 100 KB of UTF-8 bytes",
      );
    if (path.endsWith(".swift")) return; // Swift diagnostics are returned by the native compiler.
    const result = ts.transpileModule(code, {
      fileName: path,
      reportDiagnostics: true,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    });
    const errors = result.diagnostics?.filter(
      (item) => item.category === ts.DiagnosticCategory.Error,
    );
    if (errors?.length)
      throw new CanvasError(
        "invalid_source",
        errors
          .map((item) => {
            const position = item.file?.getLineAndCharacterOfPosition(
              item.start ?? 0,
            );
            const location = position
              ? `${path}:${position.line + 1}:${position.character + 1}`
              : path;
            return `${location}: ${ts.flattenDiagnosticMessageText(item.messageText, "\n")}`;
          })
          .join("\n")
          .slice(0, 2000),
      );
  }

  private async writeJournal(project: Project, files: Files) {
    for (const [path, code] of Object.entries(files)) {
      const target = await projectPath(
        this.directory,
        SourcePath.parse(path),
        true,
      );
      if (code === null)
        await unlink(target).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      else await writeFileAtomically(target, code);
    }
    await writeFileAtomically(
      await projectPath(this.directory, manifest),
      JSON.stringify(project, null, 2) + "\n",
    );
    await unlink(
      await projectPath(this.directory, ".expo-canvas/pending.json"),
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  private async commit(document: CanvasDocument, files: Files) {
    // Enforce limits before any journal or authored file is written, including
    // files added externally since the last watcher notification.
    await this.refreshSources();
    const sourcePaths = new Set(Object.keys(this.files));
    for (const [path, code] of Object.entries(files)) {
      if (code === null) sourcePaths.delete(path);
      else sourcePaths.add(path);
    }
    if (sourcePaths.size > sourceLimit)
      throw new CanvasError(
        "source_limit",
        "A project supports at most 256 source files",
      );
    const project = ProjectSchema.parse({
      ...this.project,
      sequence: this.project.sequence + 1,
      document,
    });
    // The write-ahead journal makes a multi-file source + canvas edit recoverable after a crash.
    await writeFileAtomically(
      await projectPath(this.directory, ".expo-canvas/pending.json", true),
      JSON.stringify({ project, files }),
    );
    await this.writeJournal(project, files);
    this.project = project;
    this.selection = this.selection.filter((id) => document.screens[id]);
    await this.refreshSources();
    await this.writeRegistry();
  }

  /** One request namespace for commands and adapter imports, including retries
   * that arrive while an import is still discovering its source map. */
  async runRequest<T>(request: {requestId: string}, action: () => Promise<T>): Promise<T> {
    const hash = digest(JSON.stringify(request));
    const existing = this.receipts.get(request.requestId);
    if (existing) {
      if (existing.hash !== hash)
        throw new CanvasError("request_reused", "A request ID cannot be reused with different edits", 409);
      return existing.result as Promise<T>;
    }
    const receipt = {hash, result: Promise.resolve().then(action), settled: false};
    this.receipts.set(request.requestId, receipt);
    try {
      const result = await receipt.result;
      receipt.settled = true;
      for (const [id, entry] of this.receipts) {
        if (this.receipts.size <= 200) break;
        if (entry.settled) this.receipts.delete(id);
      }
      return result;
    } catch (error) {
      this.receipts.delete(request.requestId);
      throw error;
    }
  }

  async execute(input: Command): Promise<CommandResult> {
    const command = CommandSchema.parse(input);
    return this.runRequest(command, () => this.mutex.run(async () => {
      this.assertIdentity(command);
      const before = structuredClone(this.project.document),
        document = structuredClone(before);
      const beforeFiles: Files = {},
        afterFiles: Files = {},
        created: Record<string, string> = {};
      const source = async (path: string) =>
        path in afterFiles ? afterFiles[path] : this.readOptional(path);
      const writeSource = async (
        path: string,
        code: string,
        expectedHash: string | null,
      ) => {
        const previous = await source(path);
        if ((previous === null ? null : digest(previous)) !== expectedHash)
          throw new CanvasError(
            "stale_source",
            `${path} changed. Read its source hash again.`,
            409,
          );
        this.validateCode(path, code);
        if (!(path in beforeFiles)) beforeFiles[path] = previous;
        afterFiles[path] = code;
      };
      for (const operation of command.operations) {
        if (operation.type === "screen.create") {
          const spec = operation.screen;
          if (
            Object.values(document.screens).some(
              (screen) => screen.key === spec.key,
            )
          )
            throw new CanvasError(
              "duplicate_key",
              `A screen already uses the key ${spec.key}`,
            );
          const id = `screen-${randomUUID()}`;
          const path = spec.source ?? `screens/${spec.key}.tsx`;
          if (spec.code !== undefined || !spec.source)
            await writeSource(
              path,
              spec.code ?? screenTemplate(spec.name),
              null,
            );
          if ((await source(path)) === null)
            throw new CanvasError(
              "source_missing",
              `Create ${path} before registering this screen`,
            );
          const last = document.screens[document.screenIds.at(-1) ?? ""];
          const { code, ...rest } = spec;
          document.screens[id] = ScreenSchema.parse({
            ...rest,
            id,
            source: path,
            x: spec.x ?? (last ? last.x + last.width + 88 : 0),
          });
          document.screenIds.push(id);
          created[spec.key] = id;
        } else if (operation.type === "screen.update") {
          const screen = document.screens[operation.id];
          if (!screen)
            throw new CanvasError(
              "screen_missing",
              "Screen does not exist",
              404,
            );
          document.screens[screen.id] = ScreenSchema.parse({
            ...screen,
            ...operation.patch,
          });
        } else if (operation.type === "screen.remove") {
          if (!document.screens[operation.id])
            throw new CanvasError(
              "screen_missing",
              "Screen does not exist",
              404,
            );
          delete document.screens[operation.id];
          document.screenIds = document.screenIds.filter(
            (id) => id !== operation.id,
          );
        } else if (operation.type === "source.write")
          await writeSource(
            operation.path,
            operation.code,
            operation.expectedHash,
          );
        else if (operation.type === "resolver.update") {
          const resolver = ResolverSchema.parse(document.resolver ?? {});
          for (const [prefix, directory] of Object.entries(operation.aliases ?? {})) {
            if (directory === null) delete resolver.aliases[prefix];
            else {
              if (directory.startsWith("/") && !(document.origin?.mode === "linked" && directory.startsWith(document.origin.path + "/")))
                throw new CanvasError("invalid_path", `An absolute alias must point inside the linked app (${document.origin?.path ?? "none linked"}).`);
              resolver.aliases[prefix] = directory;
            }
          }
          for (const [name, file] of Object.entries(operation.modules ?? {}))
            if (file === null) delete resolver.modules[name];
            else resolver.modules[name] = file;
          document.resolver = resolver;
        } else if (operation.type === "native.refresh") {
          if (!document.nativePreview?.projectFile || !document.origin) throw new CanvasError("invalid_project", "Choose a linked Xcode target.");
          const path = await projectPath(document.origin.path, document.nativePreview.projectFile);
          if (digest(await readRegularFileBounded(path, 4_000_000)) !== operation.expectedHash)
            throw new CanvasError("source_conflict", "The Xcode project changed during import. Import again.", 409);
          const refreshed = await loadSwiftProject(document.origin.path);
          if (refreshed.target !== document.nativePreview.target || refreshed.projectFile !== document.nativePreview.projectFile)
            throw new CanvasError("invalid_project", "The selected Xcode target changed. Create a new experiment.");
          document.nativePreview = {...refreshed, overrides: document.nativePreview.overrides, ...(document.nativePreview.context ? {context:document.nativePreview.context} : {})};
        } else if (operation.type === "native.context") {
          if (!document.nativePreview) throw new CanvasError("invalid_project", "Choose a Swift project.");
          document.nativePreview.context=operation.context;
        } else if (operation.type === "native.override") {
          if (!document.nativePreview || !document.origin || !document.nativePreview.files.includes(operation.appPath))
            throw new CanvasError("invalid_source", "Choose a Swift source from this project's native input list.");
          const original = await readRegularFileBounded(await projectPath(document.origin.path, operation.appPath), 1_000_000);
          if (digest(original) !== operation.expectedHash) throw new CanvasError("source_conflict", "The original Swift source changed. Read it again before creating an override.", 409);
          if (operation.source === null) delete document.nativePreview.overrides[operation.appPath];
          else {
            if (!operation.source.startsWith("lib/") || !operation.source.endsWith(".swift") || await source(operation.source) === null)
              throw new CanvasError("invalid_source", "Create a Swift override under lib/ in this transaction first.");
            document.nativePreview.overrides[operation.appPath] = operation.source;
            document.origin.files[operation.source] = {from: operation.appPath, hash: operation.expectedHash};
          }
        } else document.name = operation.name;
      }
      DocumentSchema.parse(document);
      for (const screen of Object.values(document.screens))
        if ((await source(screen.source)) === null)
          throw new CanvasError(
            "source_missing",
            `Missing source: ${screen.source}`,
          );
      for (const [name, file] of Object.entries(document.resolver?.modules ?? {}))
        if ((await source(file)) === null)
          throw new CanvasError(
            "source_missing",
            `Module ${name} maps to a missing project file: ${file}`,
          );
      await this.commit(document, afterFiles);
      this.undoStack.push({
        label: command.label,
        before,
        after: structuredClone(document),
        beforeFiles,
        afterFiles,
      });
      if (this.undoStack.length > 50) this.undoStack.shift();
      this.redoStack = [];
      const result = { session: this.session(), created };
      this.emit();
      return result;
    }));
  }

  /**
   * Copy source from an existing Expo app into this project as one undoable
   * transaction, recording provenance and the app's import alias. The original
   * app is read, never written.
   */
  async importSources(input: unknown): Promise<ImportResult> {
    const request = ImportSchema.parse(input);
    if(request.swiftPreviews?.length) throw new Error('Selected native component previews require a Swift project.');
    if (request.swiftContext) throw new CanvasError('invalid_adapter', 'Swift context is only available for a Swift project.', 400);
    return this.runRequest(request, () => this.mutex.run(async () => {
      this.assertIdentity(request);
      const plan = await planImport(this.directory, request);
      const before = structuredClone(this.project.document),
        document = structuredClone(before);
      if (document.origin && (document.origin.path !== plan.from || document.origin.mode !== plan.mode))
        throw new CanvasError(
          "import_conflict",
          `This project already imported ${document.origin.name} (${document.origin.mode}). Use a separate project for another app or mode.`,
        );
      const beforeFiles: Files = {},
        afterFiles: Files = {};
      const files: Origin["files"] = { ...(document.origin?.files ?? {}) };
      for (const file of plan.planned) {
        const existing = await this.readOptional(file.to);
        if (existing !== null && existing !== file.code)
          throw new CanvasError(
            "import_conflict",
            `${file.to} already exists with different content. Remove it or exclude ${file.from}.`,
          );
        files[file.to] = { from: file.from, hash: file.hash };
        if (existing === file.code) continue;
        this.validateCode(file.to, file.code);
        beforeFiles[file.to] = null;
        afterFiles[file.to] = file.code;
      }
      const copiedModules = request.modules?.length
        ? await copyModules(this.directory, plan.from, request.modules)
        : [];
      document.origin = {
        path: plan.from,
        name: plan.name,
        mode: plan.mode,
        root: plan.root,
        commit: plan.commit,
        importedAt: Date.now(),
        files,
      };
      document.resolver = ResolverSchema.parse({
        aliases: { ...(document.resolver?.aliases ?? {}), ...plan.aliases },
        modules: document.resolver?.modules ?? {},
      });
      if (plan.routeMap) {
        if (plan.previewSdk) document.appPreview = { sdk: plan.previewSdk, routesDirectory: plan.routeMap.routesDirectory, ...(request.offline ? { offline: true } : {}) };
        const mergedKeys = new Map<string, string>();
        // Older maps emitted one generated frame per shared group. Consolidate
        // untouched copies; authored variants, notes and source are preserved.
        for (const screen of Object.values(document.screens)) {
          const route = screen.props.route;
          if (!route || typeof route !== "object" || Array.isArray(route)) continue;
          if (route.step) continue;
          const canonical = plan.routeMap.frames.find(frame => frame.file === route.file && frame.contexts?.some(context => context.fullPath === route.fullPath));
          if (!canonical || canonical.key === screen.key || screen.source !== `screens/route-${screen.key}.tsx`
            || screen.notes !== route.notes || JSON.stringify(screen.links) !== JSON.stringify(route.links)
            || (Object.keys((screen.props.params as object) ?? {}).length && !screen.props.routeExample)) continue;
          const code = await this.readOptional(screen.source);
          if (code !== linkedRouteSource) continue;
          mergedKeys.set(screen.key, canonical.key);
          delete document.screens[screen.id];
          document.screenIds = document.screenIds.filter(id => id !== screen.id);
          if (!Object.values(document.screens).some(other => other.source === screen.source)) {
            beforeFiles[screen.source] = code;
            afterFiles[screen.source] = null;
          }
        }
        for (const screen of Object.values(document.screens)) screen.links = [...new Set(screen.links.map(key => mergedKeys.get(key) ?? key))];
        for (const frame of plan.routeMap.frames) {
          const notes = request.preview ? frame.notes.replace("Static route map, not a live app preview. Dynamic destinations and runtime layout options may be unresolved.", "Live linked app route. App providers, native navigation and bundled content run in an isolated frame; protected routes are visible. Dynamic records require real route parameters.") : frame.notes;
          const path = `screens/route-${frame.key}.tsx`;
          const existing = Object.values(document.screens).find((screen) => screen.key === frame.key);
          // Import adds missing routes; human/agent edits and stable IDs survive re-import.
          if (existing) {
            if (existing.source !== path) throw new CanvasError("import_conflict", `Screen key ${frame.key} already belongs to ${existing.source}.`);
            const previousRoute = existing.props.route;
            if (previousRoute && typeof previousRoute === "object" && !Array.isArray(previousRoute) && previousRoute.file === frame.file) {
              if (existing.name === previousRoute.name) existing.name = frame.name;
              if (existing.notes === previousRoute.notes) existing.notes = notes;
              if (JSON.stringify(existing.links) === JSON.stringify(previousRoute.links)) existing.links = frame.links;
              existing.props.route = JSON.parse(JSON.stringify({ ...previousRoute, contexts: frame.contexts ?? [], name: frame.name, links: frame.links, notes, ...(frame.step ? { step: frame.step } : {}), guardTransitions: frame.guardTransitions, linkEvidence: frame.linkEvidence ?? [] }));
            }
            // Upgrade only untouched generated metadata cards; preserve authored source and metadata.
            if (request.preview) {
              const old = await this.readOptional(path);
              if (old === routeCard(frame)) {
                beforeFiles[path] = old;
                afterFiles[path] = linkedRouteSource;
                existing.height = 874;
                existing.insets = { top: 59, bottom: 34, left: 0, right: 0 };
                existing.props.issues = plan.previewIssues ?? [];
                if (existing.notes === frame.notes) existing.notes = notes;
                const route = existing.props.route;
                if (route && typeof route === "object" && !Array.isArray(route) && route.notes === frame.notes) route.notes = notes;
              }
            }
            continue;
          }
          if (await this.readOptional(path) !== null) throw new CanvasError("import_conflict", `${path} already exists. Import will not overwrite it.`);
          const code = request.preview ? linkedRouteSource : routeCard(frame);
          this.validateCode(path, code);
          beforeFiles[path] = null;
          afterFiles[path] = code;
          const id = randomUUID();
          document.screenIds.push(id);
          document.screens[id] = ScreenSchema.parse({
            id, key: frame.key, name: frame.name, source: path, x: 0, y: 0, height: request.preview ? 874 : 660,
            ...(request.preview ? { insets: { top: 59, bottom: 34, left: 0, right: 0 } } : {}),
            notes, links: frame.links,
            props: { route: request.preview ? { ...frame, notes } : frame, ...(request.preview ? { params: {} } : { issues: plan.previewIssues ?? [], destinations: frame.links.map((key) => ({ key, name: plan.routeMap!.frames.find((target) => target.key === key)!.name })) }) },
          });
        }
        // Arrange only the initial map. Later imports preserve the person's placement.
        if (before.screenIds.length === 0)
          for (const move of arrangeByFlow(document)) Object.assign(document.screens[move.id], move.patch);
      }
      if (request.name || before.screenIds.length === 0)
        document.name = request.name ?? plan.name;
      DocumentSchema.parse(document);
      await this.commit(document, afterFiles);
      this.undoStack.push({
        label: `Import ${plan.name}`,
        before,
        after: structuredClone(document),
        beforeFiles,
        afterFiles,
      });
      if (this.undoStack.length > 50) this.undoStack.shift();
      this.redoStack = [];
      const { planned, ...report } = plan;
      const result: ImportResult = {
        session: this.session(),
        import: { ...report, copiedModules },
      };
      this.emit();
      return result;
    }));
  }

  history(direction: "undo" | "redo", identity: Identity) {
    return this.mutex.run(async () => {
      this.assertIdentity(identity);
      const from = direction === "undo" ? this.undoStack : this.redoStack,
        to = direction === "undo" ? this.redoStack : this.undoStack;
      const entry = from.at(-1);
      if (!entry)
        throw new CanvasError("history_empty", `Nothing to ${direction}`);
      const expected =
        direction === "undo" ? entry.afterFiles : entry.beforeFiles;
      for (const [path, code] of Object.entries(expected))
        if ((await this.readOptional(path)) !== code)
          throw new CanvasError(
            "stale_source",
            `Cannot ${direction}: ${path} was edited outside this transaction`,
            409,
          );
      await this.commit(
        direction === "undo" ? entry.before : entry.after,
        direction === "undo" ? entry.beforeFiles : entry.afterFiles,
      );
      from.pop();
      to.push(entry);
      this.emit();
      return this.session();
    });
  }

  async close() {
    this.watching.abort();
    clearTimeout(this.refreshTimer);
    await this.mutex.run(async () => {});
    this.listeners.clear();
  }
}

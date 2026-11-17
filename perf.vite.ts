/**
 * Perf build of a source tree (PERF_ROOT) whose perf probe switches rainbow brackets
 * at runtime (globalThis.__RAINBOW_MODE: off | brackets). Not part of the repository.
 */
import { defineConfig, mergeConfig, type Plugin } from "vite";
import { pathToFileURL } from "node:url";

const root = process.env.PERF_ROOT;
if (!root) throw new Error("PERF_ROOT is required");

const probeHook: Plugin = {
  name: "rainbow-perf-settings",
  enforce: "pre",
  transform(code, id) {
    if (!id.endsWith("/src/workbench/perfProbe.ts")) return null;
    const needle = "openFile: (path) => editorService().openFile(path),";
    const imp = 'import { openProject } from "@/platform/project";';
    if (!code.includes(needle) || !code.includes(imp)) throw new Error(`perfProbe shape changed in ${id}`);
    return `import { DEFAULT_SETTINGS } from "@/features/settings/model/schema";\n${code}`
      .replace(imp, 'import { openProject, useProject } from "@/platform/project";')
      .replace(
        needle,
        `openFile: (path) => {
        const mode = (globalThis as { __RAINBOW_MODE?: string }).__RAINBOW_MODE ?? "brackets";
        const settings = useProject.getState().settings ?? DEFAULT_SETTINGS;
        useProject.setState({ settings: { ...settings, editor: { ...settings.editor, rainbowBrackets: mode === "brackets" } } });
        return editorService().openFile(path);
      },`,
      );
  },
};

export default defineConfig(async (env) => {
  const base = (await import(pathToFileURL(`${root}/vite.config.ts`).href)).default;
  const resolved = typeof base === "function" ? await base(env) : base;
  return mergeConfig(resolved, { root, cacheDir: process.env.PERF_CACHE, plugins: [probeHook] });
});

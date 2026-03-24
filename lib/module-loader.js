import path from "path";
import { globSync } from "glob";
import { pathToFileURL } from "url";

async function loadModules(cwd, options = {}) {
  const { excludesAll, excludes, includes, rule } = options;
  const files = globSync(rule, { cwd });
  const modules = [];

  for (const file of files) {
    const filePath = path.resolve(cwd, file);

    let ignored = excludesAll === true;

    if (excludes) {
      for (const pattern of excludes) {
        if (filePath.includes(pattern)) ignored = true;
      }
    }

    if (includes) {
      for (const pattern of includes) {
        if (filePath.includes(pattern)) ignored = false;
      }
    }

    if (!ignored) {
      const { default: mod } = await import(pathToFileURL(filePath).href);
      modules.push(mod);
    }
  }

  return modules;
}

export default loadModules;

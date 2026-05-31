import "bun";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { z } from "zod";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import * as p from "@clack/prompts";


const AppEntrySchema = z.array(
  z.record(z.string(), z.string())
);

const AppSchema = z.record(z.string(), AppEntrySchema);

const ApplicationsSchema = z.object({
  Applications: z.object({
    install: z.array(z.string()).optional(),
    remove: z.array(z.string()).optional(),
    apps: z.record(z.string(), z.array(z.string())).optional(),
  }).optional(),
});

const ConfigSchema = z.object({
  Config: z.boolean().optional(),
  Configs: z.array(AppSchema),
}).passthrough();

type MergedEntry = Record<string, string>;

function mergeEntry(entry: Array<Record<string, string>>): MergedEntry {
  return entry.reduce((acc, cur) => ({ ...acc, ...cur }), {});
}

const MergedEntrySchema = z.object({
  config: z.string().optional(),
  target: z.string(),
  url: z.string().url().optional(),
  github: z.string().optional(),
  if_os: z.string().optional(),
  if_hostname: z.string().optional(),
  if_file_exists: z.string().optional(),
  if_env: z.string().optional(),
}).refine(
  (data) => data.config || data.url || data.github,
  { message: "Entry must have one of: 'config', 'url', or 'github'" }
);

export type ValidatedConfig = z.infer<typeof ConfigSchema>;

export function validateConfig(raw: unknown) {
  const schemaResult = ConfigSchema.safeParse(raw);
  if (!schemaResult.success) return schemaResult;

  for (const appObj of schemaResult.data.Configs) {
    for (const [, entries] of Object.entries(appObj)) {
      const merged = mergeEntry(entries);
      const entryResult = MergedEntrySchema.safeParse(merged);
      if (!entryResult.success) return entryResult;
    }
  }
  return { success: true as const, data: schemaResult.data } as const;
}

export function resolveEntry(entries: Array<Record<string, string>>) {
  const merged = mergeEntry(entries);
  const result = MergedEntrySchema.safeParse(merged);
  if (!result.success) {
    console.error(chalk.red("Invalid entry:", result.error.issues));
    process.exit(1);
  }
  return result.data;
}

export async function Getfile(filePath: string): Promise<string> {
  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
      throw new Error("ENOENT");
    }

    return await file.text();
  } catch (error: any) {
    // Check for our manual throw or the system error code
    if (error.message === "ENOENT" || error.code === "ENOENT") {
      console.error(chalk.red(`\nFile not found: ${path.resolve(filePath)}`));
      console.log(
        chalk.yellow(
          "Please provide a valid file path or run",
          chalk.white.bold("'simply-declare init'"),
          "to create a new config file."
        )
      );
    } else {
      console.error(chalk.red("Error reading file:"), error);
    }
    process.exit(1);
  }
}

export async function symlinker(source: string, destination: string, app?: string) {
  try {
    // Ensure parent directory for destination exists
    const destDir = path.dirname(destination);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.symlinkSync(source, destination, "file");
    console.log(chalk.green(`✔ Symlink for ${app} created successfully!`));
  } catch (err: any) {
    if (err.code === "EPERM") {
      console.error(
        chalk.red(
          "Permission denied. Try running with elevated privileges (sudo/admin)."
        )
      );
      process.exit(1);
    } else if (err.code === "EEXIST") {
      const response = prompt(
        `Target file for ${app} already exists. Overwrite? (y/n): `
      );

      if (response?.toLowerCase() === "y") {
        await Bun.file(destination).delete();
        console.log(chalk.yellow("Existing file deleted. Re-linking..."));
        await symlinker(source, destination, app);
      } else {
        console.log(chalk.blue(`Skipping ${app}.`));
      }
    } else {
      console.error(
        chalk.red(`Error creating symlink for ${app}:`),
        err.message
      );
    }
  }
}


export async function main(configPath: string) {
  const fileContent = await Getfile(configPath);

  let parsed: any;
  try {
    parsed = parseYaml(fileContent);
  } catch (error: any) {
    console.error(chalk.red(`Failed to parse YAML: ${error.message}`));
    process.exit(1);
  }

  const result = validateConfig(parsed);
  if (!result.success) {
    console.error(chalk.red("Invalid configuration:"));
    for (const issue of result.error.issues) {
      console.error(chalk.red(`  - ${issue.path.join(".")}: ${issue.message}`));
    }
    process.exit(1);
  }

  const parsedAny = parsed as any;

  if (parsedAny.Configs) {
    console.log(
      chalk.blue(`Processing ${parsedAny.Configs.length} config symlink(s)...`)
    );

    for (const appObj of parsedAny.Configs) {
      for (const [appName, entries] of Object.entries(appObj)) {
        const entry = resolveEntry(entries as Array<Record<string, string>>);

        if (!checkConditions(entry, appName)) continue;

        if (entry.url) {
          console.log(chalk.cyan(`Downloading ${appName} from URL...`));
          await download(entry.url, path.resolve(entry.target));
        } else if (entry.github) {
          const [owner, repo, repoPath] = await parseGit(entry.github);
          const url = await Getgit(owner, repo, repoPath);
          console.log(chalk.cyan(`Downloading ${appName} from GitHub...`));
          await download(url, path.resolve(entry.target));
        } else if (entry.config) {
          await symlinker(
            path.resolve(entry.config),
            path.resolve(entry.target),
            appName
          );
        }
      }
    }
  }

  if (parsedAny.Applications) {
    await processApplications(parsedAny.Applications);
  }

  console.log(chalk.green.bold("\nAll declarations processed."));
}

export function checkConditions(entry: z.infer<typeof MergedEntrySchema>, appName: string): boolean {
  if (entry.if_os) {
    const expected = entry.if_os.toLowerCase();
    const current = process.platform;
    const match =
      expected === "win32" || expected === "windows" ? current === "win32" :
      expected === "darwin" || expected === "macos" ? current === "darwin" :
      expected === current;
    if (!match) {
      console.log(chalk.dim(`  Skipping ${appName} — OS condition not met (expected "${entry.if_os}", got "${current}")`));
      return false;
    }
  }

  if (entry.if_hostname) {
    const hostname = require("os").hostname();
    if (hostname !== entry.if_hostname) {
      console.log(chalk.dim(`  Skipping ${appName} — hostname condition not met (expected "${entry.if_hostname}", got "${hostname}")`));
      return false;
    }
  }

  if (entry.if_file_exists) {
    const resolved = path.resolve(entry.if_file_exists);
    if (!fs.existsSync(resolved)) {
      console.log(chalk.dim(`  Skipping ${appName} — file not found: ${resolved}`));
      return false;
    }
  }

  if (entry.if_env) {
    if (!process.env[entry.if_env]) {
      console.log(chalk.dim(`  Skipping ${appName} — env var "${entry.if_env}" is not set`));
      return false;
    }
  }

  return true;
}

const COMMON_APPS: Record<string, string[]> = {
  windows: [
    "git", "nodejs", "rustup", "python", "vscode", "obsidian",
    "docker", "neovim", "wezterm", "alacritty", "7zip", "vlc",
  ],
  linux: [
    "git", "nodejs", "rustup", "python3", "code", "docker",
    "neovim", "build-essential", "curl", "wget",
  ],
  darwin: [
    "git", "node", "rustup", "python3", "visual-studio-code",
    "docker", "neovim", "wezterm", "alacritty",
  ],
};

async function addConfigEntriesTUI(config: any[]) {
  let adding = true;
  while (adding) {
    const name = (await p.text({
      message: "Name for this config entry (e.g. WezTerm, Neovim):",
      validate: (v) => (v ? undefined : "Name is required"),
    })) as string;
    if (p.isCancel(name)) break;

    const sourceType = (await p.select({
      message: "Source type:",
      options: [
        { value: "config", label: "Local file (symlink)" },
        { value: "url", label: "Download from URL" },
        { value: "github", label: "GitHub raw file" },
      ],
    })) as string;
    if (p.isCancel(sourceType)) break;

    let sourceValue: string;
    if (sourceType === "github") {
      sourceValue = (await p.text({
        message: "GitHub reference (format: owner:repo:path):",
        validate: (v) =>
          (v ?? "").split(":").length === 3
            ? undefined
            : "Must be in format owner:repo:path",
      })) as string;
    } else if (sourceType === "url") {
      sourceValue = (await p.text({
        message: "URL to download:",
        validate: (v) => (v ? undefined : "URL is required"),
      })) as string;
    } else {
      sourceValue = (await p.text({
        message: "Path to local config file:",
        validate: (v) => (v ? undefined : "Path is required"),
      })) as string;
    }
    if (p.isCancel(sourceValue)) break;

    const target = (await p.text({
      message: "Target path (where to place the config):",
      validate: (v) => (v ? undefined : "Target path is required"),
    })) as string;
    if (p.isCancel(target)) break;

    const addConditions = await p.confirm({
      message: "Add conditions for this entry?",
      initialValue: false,
    });
    if (p.isCancel(addConditions)) break;

    let if_os: string | undefined;
    let if_hostname: string | undefined;
    let if_file_exists: string | undefined;
    let if_env: string | undefined;

    if (addConditions) {
      const conditionType = (await p.multiselect({
        message: "Select conditions to add:",
        options: [
          { value: "if_os", label: "OS filter" },
          { value: "if_hostname", label: "Hostname filter" },
          { value: "if_file_exists", label: "File exists filter" },
          { value: "if_env", label: "Environment variable set" },
        ],
      })) as string[];
      if (p.isCancel(conditionType)) break;

      if (conditionType.includes("if_os")) {
        if_os = (await p.select({
          message: "Only run on which OS?",
          options: [
            { value: "win32", label: "Windows" },
            { value: "linux", label: "Linux" },
            { value: "darwin", label: "macOS" },
          ],
        })) as string;
      }
      if (conditionType.includes("if_hostname")) {
        if_hostname = (await p.text({
          message: "Expected hostname:",
          placeholder: require("os").hostname(),
        })) as string;
      }
      if (conditionType.includes("if_file_exists")) {
        if_file_exists = (await p.text({
          message: "Only run if this file exists:",
        })) as string;
      }
      if (conditionType.includes("if_env")) {
        if_env = (await p.text({
          message: "Only run if this env var is set:",
        })) as string;
      }
    }

    const entry: any[] = [[name, [] as any[]]];
    // We need to build the format: [{name: {config: ..., target: ...}}]
    // Actually the format is: [{AppName: [{config: "..."}, {target: "..."}]}]
    const entryObj: Record<string, any> = {};
    entryObj[name] = [
      { [sourceType]: sourceValue },
      { target },
    ];
    if (if_os) entryObj[name].push({ if_os });
    if (if_hostname) entryObj[name].push({ if_hostname });
    if (if_file_exists) entryObj[name].push({ if_file_exists });
    if (if_env) entryObj[name].push({ if_env });

    config.push(entryObj);

    const more = await p.confirm({
      message: "Add another config entry?",
      initialValue: false,
    });
    if (p.isCancel(more)) break;
    adding = more;
  }
}

export async function initConfig() {
  p.intro(chalk.bgBlue(" simply-declare init "));

  const whatToDo = await p.multiselect({
    message: "What would you like to set up?",
    options: [
      { value: "configs", label: "Config symlinks/downloads" },
      { value: "apps", label: "Application management (install/remove)" },
    ],
    required: true,
  });
  if (p.isCancel(whatToDo)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const config: Record<string, any> = {};

  if (whatToDo.includes("configs")) {
    const configs: any[] = [];
    await addConfigEntriesTUI(configs);
    config.Configs = configs;
  }

  if (whatToDo.includes("apps")) {
    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
    const commonApps = COMMON_APPS[platform] || [];

    const mode = await p.select({
      message: "How to manage packages?",
      options: [
        { value: "auto", label: "Auto-detect package manager (simple)" },
        { value: "perpm", label: "Assign packages per package manager" },
        { value: "both", label: "Both" },
      ],
    });
    if (p.isCancel(mode)) { p.cancel("Cancelled."); process.exit(0); }

    config.Applications = {};

    if (mode === "auto" || mode === "both") {
      const install = await p.multiselect({
        message: "Select applications to install:",
        options: [
          ...commonApps.map((a) => ({ value: a, label: a })),
          { value: "__custom__", label: "Custom package..." },
        ],
      });
      if (p.isCancel(install)) { p.cancel("Cancelled."); process.exit(0); }

      const installList: string[] = [];
      for (const item of (install as string[])) {
        if (item === "__custom__") {
          const custom = await p.text({ message: "Package name to install:" });
          if (!p.isCancel(custom) && custom) installList.push(custom);
        } else {
          installList.push(item);
        }
      }

      const remove = await p.multiselect({
        message: "Select applications to remove:",
        options: [
          ...commonApps.map((a) => ({ value: a, label: a })),
          { value: "__custom__", label: "Custom package..." },
        ],
      });
      if (p.isCancel(remove)) { p.cancel("Cancelled."); process.exit(0); }

      const removeList: string[] = [];
      for (const item of (remove as string[])) {
        if (item === "__custom__") {
          const custom = await p.text({ message: "Package name to remove:" });
          if (!p.isCancel(custom) && custom) removeList.push(custom);
        } else {
          removeList.push(item);
        }
      }

      if (installList.length) config.Applications.install = installList;
      if (removeList.length) config.Applications.remove = removeList;
    }

    if (mode === "perpm" || mode === "both") {
      const knownPms = process.platform === "win32"
        ? ["winget", "choco", "scoop"]
        : ["apt", "pacman", "dnf", "brew"];
      const selectedPms = await p.multiselect({
        message: "Which package managers to configure?",
        options: knownPms.map((pm) => ({ value: pm, label: pm })),
      });
      if (p.isCancel(selectedPms)) { p.cancel("Cancelled."); process.exit(0); }

      const appsRecord: Record<string, string[]> = {};
      for (const pm of (selectedPms as string[])) {
        const pkgs = await p.text({
          message: `Packages for ${pm} (comma-separated):`,
          placeholder: "cowsay, neofetch, lolcat",
        });
        if (p.isCancel(pkgs)) { p.cancel("Cancelled."); process.exit(0); }
        const list = (pkgs as string).split(",").map((s) => s.trim()).filter(Boolean);
        if (list.length) appsRecord[pm] = list;
      }

      if (Object.keys(appsRecord).length) config.Applications.apps = appsRecord;
    }
  }

  const yaml = stringifyYaml(config);
  await Bun.write(Bun.file("SimplyDeclare.yml"), yaml);

  p.outro(chalk.green("Configuration file 'SimplyDeclare.yml' created successfully."));
}

export async function configInteractive() {
  const configPath = "SimplyDeclare.yml";
  const exists = await Bun.file(configPath).exists();
  if (!exists) {
    console.error(chalk.red("No 'SimplyDeclare.yml' found. Run 'simply-declare init' first."));
    process.exit(1);
  }

  const content = await Getfile(configPath);
  let doc: any;
  try {
    doc = parseYaml(content);
  } catch (error: any) {
    console.error(chalk.red(`Failed to parse YAML: ${error.message}`));
    process.exit(1);
  }

  p.intro(chalk.bgBlue(" simply-declare config "));

  let editing = true;
  while (editing) {
    const numConfigs = doc.Configs?.length || 0;
    const hasApps = !!doc.Applications;
    const action = await p.select({
      message: `Current config: ${numConfigs} config entr${numConfigs === 1 ? "y" : "ies"}${hasApps ? ", Applications section" : ""}`,
      options: [
        { value: "add", label: "Add a config entry" },
        ...(numConfigs > 0 ? [{ value: "remove", label: "Remove a config entry" }] : []),
        { value: "view", label: "View full config" },
        { value: "done", label: "Done editing" },
      ],
    });
    if (p.isCancel(action)) break;

    if (action === "add") {
      if (!doc.Configs) doc.Configs = [];
      await addConfigEntriesTUI(doc.Configs);
    } else if (action === "remove") {
      const choices = doc.Configs.map((c: any, i: number) => ({
        value: i,
        label: Object.keys(c)[0] || `Entry #${i + 1}`,
      }));
      const toRemove = await p.multiselect({
        message: "Select entries to remove:",
        options: choices,
      });
      if (p.isCancel(toRemove)) continue;
      const sorted = [...toRemove].sort((a, b) => (b as number) - (a as number));
      for (const idx of sorted) {
        doc.Configs.splice(idx, 1);
      }
    } else if (action === "view") {
      console.log(chalk.cyan("\nCurrent configuration:\n"));
      console.log(stringifyYaml(doc));
      await p.select({
        message: "Press Enter to continue",
        options: [{ value: "ok", label: "OK" }],
      });
    } else if (action === "done") {
      editing = false;
    }
  }

  const yaml = stringifyYaml(doc);
  await Bun.write(Bun.file(configPath), yaml);
  p.outro(chalk.green("Configuration saved."));
}

export async function parseGit(input_from_config: string) : Promise<[string, string, string]> {
  // * 1 target :
  // Elephant-on-github:Simply_Declare:Example.yml
  // output should be string, string, string
    const parts = input_from_config.split(":");
    // optional runtime check
    if (parts.length !== 3) {
        throw new Error("Invalid git spec - expected owner:repo:path");
    }
    // tell TypeScript this is a tuple
    const [owner, repo, path] = parts as [string, string, string];
    return [owner, repo, path];

}


export async function Getgit(author: string, repo: string, relative_path: string) {
  console.log(author, repo, relative_path)
  if (!author || !repo) {
    console.error(
      chalk.red("Either author or repo is false in a github definition")
    )

    throw("error")
    //! throw more urgent error
  } else {
    let relative_p: string | undefined
    relative_p = "/" + relative_path
    const path: string = "https://raw.githubusercontent.com/" + author + "/" + repo + "/refs/heads/main" + relative_p
    console.log(path)
    return (path)
  }

}

export async function download(url: string, target: string) {
  console.log("started")
  const responsefile = await fetch(url);
  const responseText = await responsefile.text();
  await Bun.write(Bun.file(target), responseText);
  console.log(
    chalk.green(
      `Configuration file ${target} created successfully.`
    )
  );
}

type PmName = "apt" | "pacman" | "dnf" | "winget" | "brew" | "choco" | "scoop";

interface PmDefinition {
  binary: string;
  needsSudo: boolean;
  commands: {
    install: string[];
    remove: string[];
    update: string[];
    upgrade: string[];
    search: string[];
    list: string[];
    listOutdated: string[];
  };
}

const PM_REGISTRY: Record<PmName, PmDefinition> = {
  apt: {
    binary: "apt",
    needsSudo: true,
    commands: {
      install: ["install", "-y"],
      remove: ["remove", "-y"],
      update: ["install", "--only-upgrade", "-y"],
      upgrade: ["upgrade", "-y"],
      search: ["search"],
      list: ["list", "--installed"],
      listOutdated: ["list", "--upgradable"],
    },
  },
  pacman: {
    binary: "pacman",
    needsSudo: true,
    commands: {
      install: ["-S", "--noconfirm"],
      remove: ["-Rs", "--noconfirm"],
      update: ["-S", "--noconfirm"],
      upgrade: ["-Syu", "--noconfirm"],
      search: ["-Ss"],
      list: ["-Q"],
      listOutdated: ["-Qu"],
    },
  },
  dnf: {
    binary: "dnf",
    needsSudo: true,
    commands: {
      install: ["install", "-y"],
      remove: ["remove", "-y"],
      update: ["upgrade", "-y"],
      upgrade: ["upgrade", "-y"],
      search: ["search"],
      list: ["list", "installed"],
      listOutdated: ["list", "upgrades"],
    },
  },
  winget: {
    binary: "winget",
    needsSudo: false,
    commands: {
      install: ["install", "--silent", "--accept-package-agreements"],
      remove: ["uninstall", "--silent"],
      update: ["upgrade", "--silent", "--accept-package-agreements"],
      upgrade: ["upgrade", "--silent", "--accept-package-agreements", "--all"],
      search: ["search"],
      list: ["list"],
      listOutdated: ["upgrade"],
    },
  },
  brew: {
    binary: "brew",
    needsSudo: false,
    commands: {
      install: ["install"],
      remove: ["uninstall"],
      update: ["upgrade"],
      upgrade: ["upgrade"],
      search: ["search"],
      list: ["list"],
      listOutdated: ["outdated"],
    },
  },
  choco: {
    binary: "choco",
    needsSudo: true,
    commands: {
      install: ["install", "-y"],
      remove: ["uninstall", "-y"],
      update: ["upgrade", "-y"],
      upgrade: ["upgrade", "all", "-y"],
      search: ["search"],
      list: ["list"],
      listOutdated: ["outdated"],
    },
  },
  scoop: {
    binary: "scoop",
    needsSudo: false,
    commands: {
      install: ["install"],
      remove: ["uninstall"],
      update: ["update"],
      upgrade: ["update", "*"],
      search: ["search"],
      list: ["list"],
      listOutdated: ["status"],
    },
  },
};

const PM_ORDER: PmName[] = ["winget", "choco", "scoop", "apt", "pacman", "dnf", "brew"];

let detectedPms: PmName[] | null = null;

function resolveBinaryPath(binary: string): string | null {
  const isWin = process.platform === "win32";
  const name = isWin ? `${binary}.exe` : binary;

  const pathDirs = (process.env.PATH || "").split(path.delimiter);
  for (const dir of pathDirs) {
    try {
      const full = path.resolve(dir.trim(), name);
      if (fs.existsSync(full)) return full;
    } catch {}
  }

  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || "";
    const winAppsDir = path.join(localAppData, "Microsoft", "WindowsApps");
    try {
      const full = path.join(winAppsDir, name);
      if (fs.existsSync(full)) return full;
    } catch {}
  }

  try {
    const proc = Bun.spawnSync([isWin ? "where" : "which", binary]);
    if (proc.exitCode === 0) {
      return proc.stdout.toString().trim().split("\n")[0]?.trim() || null;
    }
  } catch {}
  return null;
}

function binaryExists(binary: string): boolean {
  return resolveBinaryPath(binary) !== null;
}

export async function detectPackageManagers(): Promise<PmName[]> {
  if (detectedPms) return detectedPms;

  const isWin = process.platform === "win32";
  const found: PmName[] = [];

  for (const pm of PM_ORDER) {
    if (isWin && !["winget", "choco", "scoop"].includes(pm)) continue;
    if (!isWin && ["winget", "choco", "scoop"].includes(pm)) continue;

    if (binaryExists(pm)) {
      found.push(pm);
    }
  }

  if (found.length === 0) {
    throw new Error("No supported package manager found on this system");
  }

  detectedPms = found;
  return found;
}

export async function detectPackageManager(): Promise<PmName> {
  const all = await detectPackageManagers();
  return all[0]!;
}

export function getPmName(): PmName {
  if (!detectedPms) throw new Error("Run detectPackageManagers() first");
  return detectedPms[0]!;
}

export function getAllPmNames(): PmName[] {
  if (!detectedPms) throw new Error("Run detectPackageManagers() first");
  return [...detectedPms];
}

function spawnCmd(cmd: string[]): import("bun").SyncSubprocess {
  if (process.platform === "win32") {
    const shellCmd = cmd.map(a => /[\s"]/.test(a) ? `"${a}"` : a).join(" ");
    return Bun.spawnSync(["cmd.exe", "/c", shellCmd]);
  }
  return Bun.spawnSync(cmd);
}

function printResult(proc: import("bun").SyncSubprocess) {
  const out = (proc.stdout || "").toString();
  const errOut = (proc.stderr || "").toString();
  const cleanOut = out.replace(/[\r\n]+/g, "\n").replace(/\s+$/, "");
  const cleanErr = errOut.replace(/[\r\n]+/g, "\n").replace(/\s+$/, "");

  if (proc.exitCode !== 0) {
    if (cleanErr) console.error(chalk.yellow(cleanErr));
    if (cleanOut) console.log(cleanOut);
    if (proc.exitCode !== 43) {
      console.error(chalk.red(`Command finished with exit code ${proc.exitCode}`));
    }
  } else {
    if (cleanOut) console.log(cleanOut);
    if (cleanErr) console.error(chalk.yellow(cleanErr));
  }
}

async function runPmFor(pm: PmName, action: keyof PmDefinition["commands"], pkg?: string) {
  const def = PM_REGISTRY[pm];
  const args = [...def.commands[action]];
  if (pkg) args.push(pkg);
  const binary = resolveBinaryPath(def.binary) || def.binary;
  const needsSudo = def.needsSudo && process.platform !== "win32";
  const cmd = needsSudo ? ["sudo", binary, ...args] : [binary, ...args];
  console.log(chalk.cyan(`  [${pm}] ${cmd.join(" ")}`));
  const proc = spawnCmd(cmd);
  printResult(proc);
}

async function runPm(action: keyof PmDefinition["commands"], pkg?: string) {
  const pm = await detectPackageManager();
  await runPmFor(pm, action, pkg);
}

async function runPmAll(action: keyof PmDefinition["commands"]) {
  const all = await detectPackageManagers();
  for (const pm of all) {
    console.log(chalk.blue(`\n${pm}:`));
    await runPmFor(pm, action);
  }
}

export async function appInstall(pkg: string) {
  await runPm("install", pkg);
}

export async function appInstallOn(pm: PmName, pkg: string) {
  await runPmFor(pm, "install", pkg);
}

export async function appRemove(pkg: string) {
  await runPm("remove", pkg);
}

export async function appUpdate(pkg: string) {
  await runPm("update", pkg);
}

export async function appUpgrade() {
  await runPmAll("upgrade");
}

export async function appSearch(query: string) {
  await runPm("search", query);
}

export async function appList(outdated?: boolean) {
  if (outdated) {
    await runPmAll("listOutdated");
  } else {
    await runPmAll("list");
  }
}

async function pickPackages(message: string, allowNone = false): Promise<string[]> {
  const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  const common = COMMON_APPS[platform] || [];

  const selected = await p.multiselect({
    message,
    options: [
      ...common.map((a) => ({ value: a, label: a })),
      { value: "__custom__", label: "Custom package..." },
    ],
    required: !allowNone,
  });
  if (p.isCancel(selected)) return [];

  const result: string[] = [];
  for (const item of selected) {
    if (item === "__custom__") {
      const custom = await p.text({ message: "Package name:" });
      if (!p.isCancel(custom) && custom) result.push(custom);
    } else {
      result.push(item);
    }
  }
  return result;
}

export async function appInteractive() {
  p.intro(chalk.bgBlue(" simply-declare app "));

  await detectPackageManagers();

  let running = true;
  while (running) {
    const action = await p.select({
      message: "Application Manager",
      options: [
        { value: "install", label: "Install packages" },
        { value: "remove", label: "Remove packages" },
        { value: "update", label: "Update packages" },
        { value: "upgrade", label: "Upgrade all packages" },
        { value: "search", label: "Search for a package" },
        { value: "list", label: "List installed packages" },
        { value: "outdated", label: "List outdated packages" },
        { value: "exit", label: "Exit" },
      ],
    });
    if (p.isCancel(action)) break;

    if (action === "install") {
      const pkgs = await pickPackages("Select packages to install:");
      for (const pkg of pkgs) await appInstall(pkg);
      if (pkgs.length) console.log(chalk.green(`Installed ${pkgs.length} package(s).`));
    } else if (action === "remove") {
      const pkgs = await pickPackages("Select packages to remove:");
      for (const pkg of pkgs) await appRemove(pkg);
      if (pkgs.length) console.log(chalk.green(`Removed ${pkgs.length} package(s).`));
    } else if (action === "update") {
      const pkgs = await pickPackages("Select packages to update:");
      for (const pkg of pkgs) await appUpdate(pkg);
      if (pkgs.length) console.log(chalk.green(`Updated ${pkgs.length} package(s).`));
    } else if (action === "upgrade") {
      const confirm = await p.confirm({ message: "Upgrade all packages?", initialValue: false });
      if (confirm) await appUpgrade();
    } else if (action === "search") {
      const query = await p.text({ message: "Search query:", placeholder: "e.g. neovim" });
      if (!p.isCancel(query) && query) await appSearch(query);
    } else if (action === "list") {
      await appList(false);
    } else if (action === "outdated") {
      await appList(true);
    } else if (action === "exit") {
      running = false;
    }

    if (running && action !== "exit") {
      await p.select({
        message: "Press Enter to continue",
        options: [{ value: "ok", label: "OK" }],
      });
    }
  }

  p.outro(chalk.green("Done."));
}

type ApplicationsConfig = z.infer<typeof ApplicationsSchema>;

const PM_NAME_MAP: Record<string, PmName> = {
  winget: "winget", choco: "choco", scoop: "scoop",
  apt: "apt", pacman: "pacman", dnf: "dnf", brew: "brew",
};

export async function processApplications(apps: ApplicationsConfig["Applications"]) {
  if (!apps) return;

  await detectPackageManagers();

  if (apps.install && apps.install.length > 0) {
    console.log(chalk.blue(`Installing ${apps.install.length} application(s)...`));
    for (const pkg of apps.install) {
      await appInstall(pkg);
    }
  }

  if (apps.remove && apps.remove.length > 0) {
    console.log(chalk.blue(`Removing ${apps.remove.length} application(s)...`));
    for (const pkg of apps.remove) {
      await appRemove(pkg);
    }
  }

  if (apps.apps) {
    for (const [pmName, pkgs] of Object.entries(apps.apps as Record<string, string[]>)) {
      const pm = PM_NAME_MAP[pmName.toLowerCase()];
      if (!pm) {
        console.warn(chalk.yellow(`  Unknown package manager "${pmName}" — skipping`));
        continue;
      }
      if (!binaryExists(pm)) {
        console.warn(chalk.yellow(`  Package manager "${pmName}" not found — skipping its packages`));
        continue;
      }
      console.log(chalk.blue(`  [${pmName}] Installing ${pkgs.length} package(s)...`));
      for (const pkg of pkgs) {
        await appInstallOn(pm, pkg);
      }
    }
  }
}
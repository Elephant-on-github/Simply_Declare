import "bun";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { z } from "zod";
import { parse as parseYaml } from "yaml";


const AppEntrySchema = z.array(
  z.record(z.string(), z.string())
);

const AppSchema = z.record(z.string(), AppEntrySchema);

const ApplicationsSchema = z.object({
  Applications: z.object({
    install: z.array(z.string()).optional(),
    remove: z.array(z.string()).optional(),
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

export async function initConfig() {
  console.warn(chalk.yellow("This feature Curls from a Github Repository."));
  const response = prompt(
    chalk.yellow("Do you want to proceed? (y/n): ")
  );
  if (response?.toLowerCase() === "y") {
    console.log(chalk.green("Proceeding with initialization..."));
    const responsefile = await fetch(
      "https://raw.githubusercontent.com/Elephant-on-github/Simply_Declare/refs/heads/main/Example.yml"
    );
    const responseText = await responsefile.text();
    await Bun.write(Bun.file("SimplyDeclare.yml"), responseText);
    console.log(
      chalk.green(
        "Configuration file 'SimplyDeclare.yml' created successfully."
      )
    );
  } else {
    console.log(chalk.red("Initialization cancelled by user."));
    process.exit(0);
  }
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
  const cmd = def.needsSudo ? ["sudo", binary, ...args] : [binary, ...args];
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

type ApplicationsConfig = z.infer<typeof ApplicationsSchema>;

export async function processApplications(apps: ApplicationsConfig["Applications"]) {
  if (!apps) return;
  if (apps.install && apps.install.length > 0) {
    console.log(chalk.blue(`Installing ${apps.install.length} application(s)...`));
    await detectPackageManagers();
    for (const pkg of apps.install) {
      await appInstall(pkg);
    }
  }
  if (apps.remove && apps.remove.length > 0) {
    console.log(chalk.blue(`Removing ${apps.remove.length} application(s)...`));
    await detectPackageManagers();
    for (const pkg of apps.remove) {
      await appRemove(pkg);
    }
  }
}
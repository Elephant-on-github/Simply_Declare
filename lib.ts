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

const ConfigSchema = z.object({
  Config: z.boolean().optional(),
  Configs: z.array(AppSchema),
});

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

  console.log(
    chalk.blue(`Processing ${result.data.Configs.length} application(s)...`)
  );

  for (const appObj of result.data.Configs) {
    for (const [appName, entries] of Object.entries(appObj)) {
      const entry = resolveEntry(entries);

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
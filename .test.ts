import { describe, it, expect } from "bun:test";
import { parseGit, Getgit, validateConfig, checkConditions, detectPackageManagers, detectPackageManager, getPmName, getAllPmNames } from "./lib";

describe("parseGit", () => {
  it("parses a valid owner:repo:path spec", async () => {
    const result = await parseGit("Elephant-on-github:Simply_Declare:Example.yml");
    expect(result).toEqual(["Elephant-on-github", "Simply_Declare", "Example.yml"]);
  });

  it("throws on invalid spec (wrong parts count)", async () => {
    expect(parseGit("only:two")).rejects.toThrow("Invalid git spec");
  });

  it("throws on empty string", async () => {
    expect(parseGit("")).rejects.toThrow("Invalid git spec");
  });
});

describe("Getgit", () => {
  it("builds correct raw GitHub URL", async () => {
    const result = await Getgit("InioX", "matugen", "Cargo.toml");
    expect(result).toBe(
      "https://raw.githubusercontent.com/InioX/matugen/refs/heads/main/Cargo.toml"
    );
  });

  it("handles paths with subdirectories", async () => {
    const result = await Getgit("user", "repo", "src/main.rs");
    expect(result).toBe(
      "https://raw.githubusercontent.com/user/repo/refs/heads/main/src/main.rs"
    );
  });

  it("throws when author or repo is missing", async () => {
    expect(Getgit("", "repo", "path")).rejects.toBeTruthy();
    expect(Getgit("author", "", "path")).rejects.toBeTruthy();
  });
});

describe("validateConfig", () => {
  it("accepts a valid config with local files", () => {
    const input = {
      Config: true,
      Configs: [
        { WezTerm: [{ config: "./lua.lua", target: "./wezterm.lua" }] },
      ],
    };
    const result = validateConfig(input);
    expect(result.success).toBe(true);
  });

  it("accepts a valid config with url source", () => {
    const input = {
      Configs: [
        { Remote: [{ url: "https://example.com/file", target: "./out.yml" }] },
      ],
    };
    const result = validateConfig(input);
    expect(result.success).toBe(true);
  });

  it("accepts a valid config with github source", () => {
    const input = {
      Configs: [
        { Remote: [{ github: "user:repo:path", target: "./out.yml" }] },
      ],
    };
    const result = validateConfig(input);
    expect(result.success).toBe(true);
  });

  it("rejects config missing Configs array", () => {
    const result = validateConfig({});
    expect(result.success).toBe(false);
  });

  it("rejects entry without config/url/github", () => {
    const input = {
      Configs: [
        { Foo: [{ target: "./bar.yml" }] },
      ],
    };
    const result = validateConfig(input);
    expect(result.success).toBe(false);
  });

  it("rejects entry with invalid url", () => {
    const input = {
      Configs: [
        { Foo: [{ url: "not-a-url", target: "./bar.yml" }] },
      ],
    };
    const result = validateConfig(input);
    expect(result.success).toBe(false);
  });

  it("rejects entry missing target", () => {
    const input = {
      Configs: [
        { Foo: [{ config: "./source" }] },
      ],
    };
    const result = validateConfig(input);
    expect(result.success).toBe(false);
  });

  it("handles multiple apps", () => {
    const input = {
      Configs: [
        { App1: [{ config: "./a", target: "./b" }] },
        { App2: [{ url: "https://x.com/y", target: "./z" }] },
      ],
    };
    const result = validateConfig(input);
    expect(result.success).toBe(true);
    expect(result.data!.Configs.length).toBe(2);
  });
});

describe("validateConfig with Applications", () => {
  it("accepts a config with Applications section", () => {
    const input = {
      Config: true,
      Configs: [
        { WezTerm: [{ config: "./a", target: "./b" }] },
      ],
      Applications: {
        install: ["git", "neovim"],
        remove: ["bad-app"],
      },
    };
    const result = validateConfig(input);
    expect(result.success).toBe(true);
  });

  it("accepts a config with empty Applications section", () => {
    const input = {
      Configs: [
        { App: [{ config: "./a", target: "./b" }] },
      ],
      Applications: {
        install: [],
        remove: [],
      },
    };
    const result = validateConfig(input);
    expect(result.success).toBe(true);
  });

  it("accepts a config without Applications section", () => {
    const input = {
      Configs: [
        { App: [{ config: "./a", target: "./b" }] },
      ],
    };
    const result = validateConfig(input);
    expect(result.success).toBe(true);
  });

  it("accepts a config with per-pm apps", () => {
    const input = {
      Configs: [],
      Applications: {
        apps: {
          winget: ["powertoys", "terminal"],
          scoop: ["cowsay"],
        },
      },
    };
    const result = validateConfig(input);
    expect(result.success).toBe(true);
  });
});

describe("checkConditions", () => {
  it("passes when no conditions are set", () => {
    const entry = { target: "./x", config: "./y" };
    expect(checkConditions(entry, "test")).toBe(true);
  });

  it("passes when if_os matches current platform", () => {
    const entry = { target: "./x", config: "./y", if_os: process.platform };
    expect(checkConditions(entry, "test")).toBe(true);
  });

  it("fails when if_os does not match", () => {
    const wrong = process.platform === "win32" ? "linux" : "win32";
    const entry = { target: "./x", config: "./y", if_os: wrong };
    expect(checkConditions(entry, "test")).toBe(false);
  });

  it("accepts 'windows' alias for win32", () => {
    if (process.platform === "win32") {
      const entry = { target: "./x", config: "./y", if_os: "windows" };
      expect(checkConditions(entry, "test")).toBe(true);
    }
  });

  it("accepts 'macos' alias for darwin", () => {
    if (process.platform === "darwin") {
      const entry = { target: "./x", config: "./y", if_os: "macos" };
      expect(checkConditions(entry, "test")).toBe(true);
    }
  });

  it("fails when if_file_exists file is missing", () => {
    const entry = { target: "./x", config: "./y", if_file_exists: "./nonexistent-file-12345" };
    expect(checkConditions(entry, "test")).toBe(false);
  });

  it("passes when if_file_exists file exists", () => {
    const entry = { target: "./x", config: "./y", if_file_exists: "./package.json" };
    expect(checkConditions(entry, "test")).toBe(true);
  });

  it("fails when if_env var is not set", () => {
    const entry = { target: "./x", config: "./y", if_env: "__UNLIKELY_ENV_VAR_ZZZ__" };
    expect(checkConditions(entry, "test")).toBe(false);
  });

  it("passes when if_env var is set", () => {
    const entry = { target: "./x", config: "./y", if_env: "PATH" };
    expect(checkConditions(entry, "test")).toBe(true);
  });

  it("passes when if_hostname matches", () => {
    const hostname = require("os").hostname();
    const entry = { target: "./x", config: "./y", if_hostname: hostname };
    expect(checkConditions(entry, "test")).toBe(true);
  });
});

describe("detectPackageManagers", () => {
  it("detects at least one package manager on this system", async () => {
    const all = await detectPackageManagers();
    expect(all.length).toBeGreaterThanOrEqual(1);
    for (const pm of all) {
      expect(["winget", "choco", "scoop", "apt", "pacman", "dnf", "brew"]).toContain(pm);
    }
  });

  it("returns the same list on repeated calls", async () => {
    const all1 = await detectPackageManagers();
    const all2 = await detectPackageManagers();
    expect(all1).toEqual(all2);
  });

  it("getPmName returns the first detected PM", async () => {
    await detectPackageManagers();
    const name = getPmName();
    expect(name).toBeTruthy();
  });

  it("getAllPmNames returns all detected PMs", async () => {
    await detectPackageManagers();
    const all = getAllPmNames();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  it("detectPackageManager returns the first PM (backwards compat)", async () => {
    const pm = await detectPackageManager();
    const all = await detectPackageManagers();
    expect(pm).toBe(all[0]);
  });
});
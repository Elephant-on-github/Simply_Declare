import { describe, it, expect } from "bun:test";
import { parseGit, Getgit, validateConfig, detectPackageManager, getPmName } from "./lib";

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
});

describe("detectPackageManager", () => {
  it("detects a package manager on this system", async () => {
    const pm = await detectPackageManager();
    expect(["winget", "choco", "scoop", "apt", "pacman", "dnf", "brew"]).toContain(pm);
  });

  it("returns the same PM on repeated calls", async () => {
    const pm1 = await detectPackageManager();
    const pm2 = await detectPackageManager();
    expect(pm1).toBe(pm2);
  });

  it("getPmName returns the detected PM", async () => {
    await detectPackageManager();
    const name = getPmName();
    expect(name).toBeTruthy();
  });
});
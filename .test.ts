import { describe, it, expect } from "bun:test";
import { parseGit, Getgit, validateConfig } from "./lib";

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
import { describe, it, expect } from "vitest";
import { branding } from "./branding";

describe("branding", () => {
  it("exposes the app name, short name, logo, favicon, and theme color", () => {
    expect(branding.appName).toBe("Darts League");
    expect(branding.shortName).toBe("DartsLeague");
    expect(branding.logoSrc).toBe("/branding/logo.svg");
    expect(branding.faviconSrc).toBe("/branding/favicon.svg");
    expect(branding.themeColor).toBe("#1d4ed8");
  });
});

import { expect } from "chai";
import FaviconWebpageProvider from "../../src/providers/FaviconWebpage.js";

function makeAuthorStub(domain) {
  return { getDomain: () => domain };
}

function makeWdowStub(html) {
  return {
    fetch: async () => ({
      text: async () => html,
    }),
  };
}

describe("FaviconWebpageProvider", () => {
  describe("getUrl()", () => {
    it("should return absolute favicon URLs unchanged", async () => {
      const html =
        '<link rel="icon" href="https://cdn.example.com/favicon.ico">';
      const provider = new FaviconWebpageProvider(makeWdowStub(html));
      const url = await provider.getUrl(makeAuthorStub("example.com"));
      expect(url).to.equal("https://cdn.example.com/favicon.ico");
    });

    it("should resolve protocol-relative favicon URLs", async () => {
      const html = '<link rel="icon" href="//cdn.example.com/favicon.ico">';
      const provider = new FaviconWebpageProvider(makeWdowStub(html));
      const url = await provider.getUrl(makeAuthorStub("example.com"));
      expect(url).to.equal("https://cdn.example.com/favicon.ico");
    });

    it("should resolve root-relative favicon URLs against the domain", async () => {
      const html = '<link rel="icon" href="/favicon.ico">';
      const provider = new FaviconWebpageProvider(makeWdowStub(html));
      const url = await provider.getUrl(makeAuthorStub("example.com"));
      expect(url).to.equal("https://example.com/favicon.ico");
    });

    it("should resolve bare-relative favicon URLs against the domain", async () => {
      const html = '<link rel="icon" href="favicon.ico">';
      const provider = new FaviconWebpageProvider(makeWdowStub(html));
      const url = await provider.getUrl(makeAuthorStub("example.com"));
      expect(url).to.equal("https://example.com/favicon.ico");
    });

    it("should fall back to shortcut icon when no icon link is present", async () => {
      const html = '<link rel="shortcut icon" href="/shortcut.ico">';
      const provider = new FaviconWebpageProvider(makeWdowStub(html));
      const url = await provider.getUrl(makeAuthorStub("example.com"));
      expect(url).to.equal("https://example.com/shortcut.ico");
    });

    it("should return false when no favicon link is present", async () => {
      const html = "<html><head></head><body></body></html>";
      const provider = new FaviconWebpageProvider(makeWdowStub(html));
      const url = await provider.getUrl(makeAuthorStub("example.com"));
      expect(url).to.equal(false);
    });
  });
});

import { expect } from "chai";
import Author from "../../src/src/Author.js";

const SAMPLE_AUTHOR = "John Doe <john@example.com>";
const SAMPLE_EMAIL = "john@example.com";
const SAMPLE_SUBDOMAIN_AUTHOR = "John Doe <john@mail.example.com>";
const UK_AUTHOR = "John Doe <john@example.co.uk>";
const NUMBERED_AUTHOR = "123 John Doe <john@example.com>";

describe("Author", () => {
  beforeEach(() => {
    // parse() memoizes by raw string across calls; without clearing this,
    // a test that mocks a different parseMailboxString behavior for the
    // same SAMPLE_AUTHOR string as an earlier test would see the earlier
    // test's cached result instead of its own mock.
    Author.clearParseCache();
  });

  describe("Constructor", () => {
    it("should create a Mail instance with author and email", () => {
      const mail = new Author(SAMPLE_AUTHOR, SAMPLE_EMAIL);
      expect(mail.author).to.equal(SAMPLE_AUTHOR);
      expect(mail.mail).to.equal(SAMPLE_EMAIL);
      expect(mail.hasName).to.be.true;
    });

    it("should detect when author has no name format", () => {
      const mail = new Author(SAMPLE_EMAIL, SAMPLE_EMAIL);
      expect(mail.hasName).to.be.false;
    });

    it("should detect when author has name format", () => {
      const mail = new Author(SAMPLE_AUTHOR, SAMPLE_EMAIL);
      expect(mail.hasName).to.be.true;
    });

    it("should handle null author parameter", () => {
      const mail = new Author(null, SAMPLE_EMAIL);
      expect(mail.author).to.equal("");
      expect(mail.mail).to.equal(SAMPLE_EMAIL);
      expect(mail.hasName).to.be.false;
    });

    it("should handle undefined author parameter", () => {
      const mail = new Author(undefined, SAMPLE_EMAIL);
      expect(mail.author).to.equal("");
      expect(mail.mail).to.equal(SAMPLE_EMAIL);
      expect(mail.hasName).to.be.false;
    });
  });
  describe("parse() static method", () => {
    beforeEach(() => {
      globalThis.browser = {
        messengerUtilities: {
          parseMailboxString: async () => null,
        },
      };
    });

    it("should parse emails from various formats and handle edge cases", async () => {
      // Parse from author string with name and brackets
      let email = await Author.parse(SAMPLE_AUTHOR);
      expect(email).to.equal(SAMPLE_EMAIL);

      // Parse from plain email
      email = await Author.parse(SAMPLE_EMAIL);
      expect(email).to.equal(SAMPLE_EMAIL);

      // Handle uppercase and whitespace
      email = await Author.parse("John Doe < JOHN@EXAMPLE.COM >");
      expect(email).to.equal(SAMPLE_EMAIL);

      // Handle empty string
      email = await Author.parse("");
      expect(email).to.equal("");

      // Handle null
      email = await Author.parse(null);
      expect(email).to.equal("");

      // Handle undefined
      email = await Author.parse(undefined);
      expect(email).to.equal("");
    });

    it("should use browser API when available (Thunderbird 128+)", async () => {
      globalThis.browser = {
        messengerUtilities: {
          parseMailboxString: async (author) => {
            if (author === SAMPLE_AUTHOR) {
              return [{ email: "browser@example.com" }];
            }
            return null;
          },
        },
      };

      const email = await Author.parse(SAMPLE_AUTHOR);
      expect(email).to.equal("browser@example.com");
    });

    it("should only call parseMailboxString once for concurrent calls with the same string", async () => {
      let callCount = 0;
      globalThis.browser = {
        messengerUtilities: {
          parseMailboxString: async () => {
            callCount++;
            return [{ email: "cached@example.com" }];
          },
        },
      };

      const [first, second] = await Promise.all([
        Author.parse(SAMPLE_AUTHOR),
        Author.parse(SAMPLE_AUTHOR),
      ]);

      expect(first).to.equal("cached@example.com");
      expect(second).to.equal("cached@example.com");
      expect(callCount).to.equal(1);
    });

    it("should reuse the cached result for a later sequential call", async () => {
      let callCount = 0;
      globalThis.browser = {
        messengerUtilities: {
          parseMailboxString: async () => {
            callCount++;
            return [{ email: "cached@example.com" }];
          },
        },
      };

      await Author.parse(SAMPLE_AUTHOR);
      await Author.parse(SAMPLE_AUTHOR);

      expect(callCount).to.equal(1);
    });
  });
  describe("Mail properties and basic methods", () => {
    beforeEach(() => {
      globalThis.browser = {
        messengerUtilities: {
          parseMailboxString: async () => null,
        },
      };
    });

    it("should create instance and handle name detection", async () => {
      const mailWithName = await Author.fromAuthor(SAMPLE_AUTHOR);
      expect(mailWithName.author).to.equal(SAMPLE_AUTHOR);
      expect(mailWithName.getEmail()).to.equal(SAMPLE_EMAIL);
      expect(mailWithName.hasAName()).to.be.true;

      const mailWithoutName = await Author.fromAuthor(SAMPLE_EMAIL);
      expect(mailWithoutName.hasAName()).to.be.false;
    });

    it("should have toString() return author string", async () => {
      const mail = await Author.fromAuthor(SAMPLE_AUTHOR);
      expect(mail.toString()).to.equal(SAMPLE_AUTHOR);
    });
  });
  describe("Domain methods", () => {
    it("should handle domain extraction and subdomain operations", async () => {
      const mail = await Author.fromAuthor(SAMPLE_AUTHOR);
      expect(mail.getDomain()).to.equal("example.com");
      expect(mail.getDomainWithoutTld()).to.equal("example");
      expect(mail.getTopDomain()).to.equal("example.com");
      expect(mail.hasSubDomain()).to.be.false;

      const subdomainMail = await Author.fromAuthor(SAMPLE_SUBDOMAIN_AUTHOR);
      expect(subdomainMail.getDomain()).to.equal("mail.example.com");
      expect(subdomainMail.hasSubDomain()).to.be.true;
      expect(subdomainMail.getTopDomain()).to.equal("example.com");

      const newMail = subdomainMail.removeSubDomain();
      expect(newMail.getEmail()).to.equal(SAMPLE_EMAIL);
    });

    it("should handle special domain cases", async () => {
      const ukMail = await Author.fromAuthor(UK_AUTHOR);
      expect(ukMail.getDomainWithoutTld()).to.equal("example.co");
      expect(ukMail.getTopDomain()).to.equal("co.uk");

      const invalidMail = await Author.fromAuthor("invalid-email");
      expect(invalidMail.getDomain()).to.equal("");
      expect(invalidMail.hasSubDomain()).to.be.false;
    });
  });
  describe("getInitial()", () => {
    it("should return first letter of author name when hasName is true", async () => {
      const mail = await Author.fromAuthor(`Z${SAMPLE_AUTHOR}`);
      expect(mail.getInitial()).to.equal("Z");
    });

    it("should return first letter of author name ignoring special characters", async () => {
      const mail = await Author.fromAuthor(NUMBERED_AUTHOR);
      expect(mail.getInitial()).to.equal("J");
    });

    it("should return first letter of email for public domains when no name", async () => {
      const mail = await Author.fromAuthor("john@gmail.com");
      expect(mail.getInitial()).to.equal("J");
    });

    it("should return first letter of domain for private domains when no name", async () => {
      const mail = await Author.fromAuthor("john@company.com");
      expect(mail.getInitial()).to.equal("C");
    });

    it("should handle edge cases gracefully", async () => {
      // Handle empty domain gracefully (ghost mails)
      const mail = await Author.fromAuthor("john");
      expect(mail.getInitial()).to.equal("J");

      // Return question mark for completely empty author
      const emptyMail = await Author.fromAuthor("");
      expect(emptyMail.getInitial()).to.equal("?");

      // Convert to uppercase
      const lowerMail = await Author.fromAuthor(SAMPLE_AUTHOR.toLowerCase());
      expect(lowerMail.getInitial()).to.equal("J");
    });
  });
  describe("getInitials()", () => {
    beforeEach(() => {
      globalThis.browser = {
        messengerUtilities: {
          parseMailboxString: async () => null,
        },
      };
    });

    it("should use first two words of display name", async () => {
      const mail = await Author.fromAuthor("Mary Jane <mary.jane@example.com>");
      expect(mail.getInitials()).to.equal("MJ");
    });

    it("should use local-part segments separated by dot when no display name", async () => {
      const mail = await Author.fromAuthor("mary.jane@example.com");
      expect(mail.getInitials()).to.equal("MJ");
    });

    it("should return single initial when only one word/segment", async () => {
      const mail = await Author.fromAuthor("mary@example.com");
      expect(mail.getInitials()).to.equal("M");
    });

    it("should fall back to getInitial when nothing else works", async () => {
      const mail = await Author.fromAuthor("invalid-email");
      expect(mail.getInitials()).to.equal("I");
    });
  });
  describe("Edge cases and error handling", () => {
    it("should handle malformed email addresses and empty strings gracefully", async () => {
      const invalidMail = await Author.fromAuthor("invalid-email");
      expect(invalidMail.getDomain()).to.equal("");
      expect(invalidMail.hasSubDomain()).to.be.false;
      expect(invalidMail.getInitial()).to.equal("I");

      const emptyMail = await Author.fromAuthor("");
      expect(emptyMail.getEmail()).to.equal("");
      expect(emptyMail.hasAName()).to.be.false;
      expect(emptyMail.getDomain()).to.equal("");
    });

    it("should handle null gracefully in constructor", () => {
      // Constructor converts null to empty string with || ""
      const mail = new Author("test", null);
      expect(() => mail.getEmail()).to.not.throw();
      expect(() => mail.hasAName()).to.not.throw();
      expect(() => mail.getDomain()).to.not.throw();
      expect(mail.getEmail()).to.equal("");
      expect(mail.getDomain()).to.equal("");
    });
  });
});

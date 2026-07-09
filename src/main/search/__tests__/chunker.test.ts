import { describe, it, expect } from "vitest";
import { chunkText, estimateTokens } from "../chunker";

describe("estimateTokens", () => {
  it("estimates tokens from word count", () => {
    const text = "one two three four";
    expect(estimateTokens(text)).toBe(Math.ceil(4 / 0.75));
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("chunkText", () => {
  it("splits on markdown headings", () => {
    const text = "# Intro\nHello world\n## Details\nMore info here";
    const chunks = chunkText(text, "Test Doc");
    expect(chunks.length).toBe(2);
    expect(chunks[0].heading).toBe("Intro");
    expect(chunks[0].text).toBe("Hello world");
    expect(chunks[1].heading).toBe("Details");
    expect(chunks[1].text).toBe("More info here");
  });

  it("preserves heading levels (h1 through h6)", () => {
    const text =
      "# H1\nContent 1\n## H2\nContent 2\n### H3\nContent 3\n#### H4\nContent 4";
    const chunks = chunkText(text, "Test");
    expect(chunks).toHaveLength(4);
    expect(chunks[0].heading).toBe("H1");
    expect(chunks[1].heading).toBe("H2");
    expect(chunks[2].heading).toBe("H3");
    expect(chunks[3].heading).toBe("H4");
  });

  it("handles content before the first heading", () => {
    const text = "Preamble text\n# Heading\nBody text";
    const chunks = chunkText(text, "Test");
    expect(chunks).toHaveLength(2);
    expect(chunks[0].heading).toBeNull();
    expect(chunks[0].text).toBe("Preamble text");
    expect(chunks[1].heading).toBe("Heading");
  });

  it("splits oversized sections at sentence boundaries with overlap", () => {
    const sentences = Array(200).fill("This is a sentence.").join(" ");
    const chunks = chunkText(`# Big Section\n${sentences}`, "Test");
    expect(chunks.length).toBeGreaterThan(1);

    for (let i = 1; i < chunks.length; i++) {
      const prevWords = chunks[i - 1].text.split(/\s+/);
      const currWords = chunks[i].text.split(/\s+/);
      const overlapWords = prevWords.filter(
        (w, idx) =>
          idx >= prevWords.length - Math.ceil(50 * 0.75) &&
          currWords.slice(0, Math.ceil(50 * 0.75)).includes(w),
      );
      expect(overlapWords.length).toBeGreaterThan(0);
    }
  });

  it("keeps each chunk under the max token limit", () => {
    const sentences = Array(200)
      .fill("This is a test sentence with several words.")
      .join(" ");
    const chunks = chunkText(`# Section\n${sentences}`, "Test");
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(450);
    }
  });

  it("returns empty array for empty string", () => {
    expect(chunkText("", "Empty")).toHaveLength(0);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(chunkText("   \n\n  ", "Whitespace")).toHaveLength(0);
  });

  it("handles document with no headings", () => {
    const text =
      "Paragraph one. Some content here.\n\nParagraph two. More content.\n\nParagraph three.";
    const chunks = chunkText(text, "Flat Doc");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].heading).toBeNull();
  });

  it("assigns sequential indices", () => {
    const text = "# A\nContent A\n## B\nContent B\n### C\nContent C";
    const chunks = chunkText(text, "Test");
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it("assigns sequential indices across oversized splits", () => {
    const longText = Array(200).fill("Word.").join(" ");
    const text = `# Short\nBrief.\n## Long\n${longText}`;
    const chunks = chunkText(text, "Test");
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
    }
  });

  it("computes token count for each chunk", () => {
    const text = "# Title\nSome words in this section";
    const chunks = chunkText(text, "Test");
    expect(chunks[0].tokenCount).toBe(
      Math.ceil("Some words in this section".split(/\s+/).length / 0.75),
    );
  });

  it("skips heading-only sections with no body", () => {
    const text =
      "# Title\n\n## Empty Section\n\n## Has Content\nActual content here";
    const chunks = chunkText(text, "Test");
    const headings = chunks.map((c) => c.heading);
    expect(headings).not.toContain("Empty Section");
    expect(headings).toContain("Has Content");
  });

  it("handles a single paragraph with no structure", () => {
    const text = "Just a single block of text with no structure at all.";
    const chunks = chunkText(text, "Test");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading).toBeNull();
    expect(chunks[0].text).toBe(text);
  });
});

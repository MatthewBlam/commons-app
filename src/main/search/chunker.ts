export interface ChunkData {
  index: number;
  heading: string | null;
  text: string;
  tokenCount: number;
}

const MAX_TOKENS = 400;
const OVERLAP_TOKENS = 50;
const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;

export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  return Math.ceil(words.length / 0.75);
}

function splitOnHeadings(
  text: string,
): { heading: string | null; body: string }[] {
  const lines = text.split("\n");
  const sections: { heading: string | null; body: string }[] = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = line.match(HEADING_REGEX);
    if (match) {
      const body = currentLines.join("\n").trim();
      if (body || currentHeading !== null) {
        sections.push({ heading: currentHeading, body });
      }
      currentHeading = match[2].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  const remaining = currentLines.join("\n").trim();
  if (remaining || currentHeading !== null) {
    sections.push({ heading: currentHeading, body: remaining });
  }

  return sections;
}

function splitOnParagraphs(
  text: string,
): { heading: string | null; body: string }[] {
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [];
  return [{ heading: null, body: paragraphs.join("\n\n") }];
}

function splitAtSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
}

function splitOversizedSection(
  text: string,
  heading: string | null,
  startIndex: number,
): ChunkData[] {
  const sentences = splitAtSentences(text);
  const chunks: ChunkData[] = [];
  let current: string[] = [];
  let currentTokens = 0;
  let idx = startIndex;

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);

    if (currentTokens + sentenceTokens > MAX_TOKENS && current.length > 0) {
      const chunkText = current.join(" ");
      chunks.push({
        index: idx++,
        heading,
        text: chunkText,
        tokenCount: estimateTokens(chunkText),
      });

      const overlapTarget = OVERLAP_TOKENS;
      const overlapSentences: string[] = [];
      let overlapCount = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        const st = estimateTokens(current[i]);
        if (overlapCount + st > overlapTarget && overlapSentences.length > 0)
          break;
        overlapSentences.unshift(current[i]);
        overlapCount += st;
      }
      current = [...overlapSentences];
      currentTokens = overlapCount;
    }

    current.push(sentence);
    currentTokens += sentenceTokens;
  }

  if (current.length > 0) {
    const chunkText = current.join(" ");
    chunks.push({
      index: idx,
      heading,
      text: chunkText,
      tokenCount: estimateTokens(chunkText),
    });
  }

  return chunks;
}

export function chunkText(text: string, _title: string): ChunkData[] {
  if (!text.trim()) return [];

  const hasHeadings = HEADING_REGEX.test(
    text.split("\n").find((l) => HEADING_REGEX.test(l)) ?? "",
  );
  const sections = hasHeadings
    ? splitOnHeadings(text)
    : splitOnParagraphs(text);

  if (sections.length === 0) return [];

  const chunks: ChunkData[] = [];
  let index = 0;

  for (const section of sections) {
    if (!section.body.trim()) continue;

    const tokens = estimateTokens(section.body);
    if (tokens <= MAX_TOKENS) {
      chunks.push({
        index,
        heading: section.heading,
        text: section.body,
        tokenCount: tokens,
      });
      index++;
    } else {
      const split = splitOversizedSection(section.body, section.heading, index);
      chunks.push(...split);
      index += split.length;
    }
  }

  return chunks;
}

import { Fragment } from "react";

// "2026-11-23 08:36:02" (UTC, as the server stores it) -> Date
export function parseServerTime(s) {
  return s ? new Date(s.replace(" ", "T") + "Z") : null;
}

export function timeAgo(s) {
  const d = parseServerTime(s);
  if (!d) return "";
  const sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function longDate(s) {
  const d = parseServerTime(s);
  return d ? d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
}

// Inline formatting: **bold**, *italic* and [text](https://link). Built as
// React elements, never as raw HTML, so article text can't inject markup.
function inline(text) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={m.index}>{m[1]}</strong>);
    else if (m[2]) out.push(<em key={m.index}>{m[2]}</em>);
    else out.push(<a key={m.index} href={m[4]} target="_blank" rel="noopener noreferrer nofollow">{m[3]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Simple article formatting: blank line = new paragraph, "## " heading,
// "### " small heading, "- " bullet list, "1. " numbered list, "> " quote.
export function RichText({ text }) {
  const blocks = String(text || "").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^[-•]\s+/.test(l))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^[-•]\s+/, ""))}</li>)}</ul>;
        }
        if (lines.every((l) => /^\d+[.)]\s+/.test(l))) {
          return <ol key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\d+[.)]\s+/, ""))}</li>)}</ol>;
        }
        if (lines.every((l) => /^>\s?/.test(l))) {
          return <blockquote key={i}>{inline(lines.map((l) => l.replace(/^>\s?/, "")).join(" "))}</blockquote>;
        }
        if (/^###\s+/.test(lines[0])) {
          return (
            <Fragment key={i}>
              <h4>{inline(lines[0].replace(/^###\s+/, ""))}</h4>
              {lines.length > 1 && <p>{withBreaks(lines.slice(1))}</p>}
            </Fragment>
          );
        }
        if (/^##?\s+/.test(lines[0])) {
          return (
            <Fragment key={i}>
              <h3>{inline(lines[0].replace(/^##?\s+/, ""))}</h3>
              {lines.length > 1 && <p>{withBreaks(lines.slice(1))}</p>}
            </Fragment>
          );
        }
        return <p key={i}>{withBreaks(lines)}</p>;
      })}
    </>
  );
}

function withBreaks(lines) {
  return lines.map((l, j) => (
    <Fragment key={j}>
      {j > 0 && <br />}
      {inline(l)}
    </Fragment>
  ));
}

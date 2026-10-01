import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X,
  Send,
  MessageSquarePlus,
  Loader2,
  Mic,
  Volume2,
  Search,
  PanelLeft,
} from 'lucide-react';
import useStore from '../../store/useStore';
import { API_BASE } from '../../lib/appConfig';
import { getHrvProxyMs, getRecoveryScore } from '../../utils/fitnessMetrics';
import { cn } from '../../utils/cn';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useVoiceOutput } from '../../hooks/useVoiceOutput';
import LiveCoachSessionView from './LiveCoachSessionView';
import CoachHistorySidebar, {
  type CoachSessionListItem,
} from './CoachHistorySidebar';

interface AiCoachPanelProps {
  onClose: () => void;
  /** embedded = desktop resizable column; fullscreen = mobile full-screen sheet */
  presentation?: 'embedded' | 'fullscreen';
}

type CoachInteractionMode = 'text' | 'live';

type CoachRole = 'user' | 'model';

interface CoachImageAttachment {
  type: 'image';
  imageUrl: string;
  photographerName: string;
  photographerProfileUrl: string;
}

/** Curated / legacy Pexels file hotlink. */
interface CoachVideoAttachment {
  type: 'video';
  videoUrl: string;
  photographerName: string;
  photographerProfileUrl: string;
}

interface CoachYouTubeAttachment {
  type: 'video_youtube';
  videoId: string;
  title: string;
  channelTitle: string;
}

interface CoachShoppingLinkAttachment {
  type: 'shopping_link';
  url: string;
  retailer: string;
  searchQuery: string;
}

interface CoachSourcesAttachment {
  type: 'sources';
  sources: Array<{ title: string; url: string }>;
}

type CoachAttachment =
  | CoachImageAttachment
  | CoachVideoAttachment
  | CoachYouTubeAttachment
  | CoachShoppingLinkAttachment
  | CoachSourcesAttachment;

interface CoachChatMessage {
  id: string;
  role: CoachRole;
  text: string;
  attachments?: CoachAttachment[];
}

/** Soft cap mirrored from server MAX_MESSAGES_PER_SESSION default. */
const COACH_SESSION_MESSAGE_CAP = 40;

/**
 * Below this panel width the conversation list floats over the chat as a
 * drawer; at or above it, it docks beside the chat. Keeps the chat column
 * usable on phones and in the default 30% desktop column.
 */
const HISTORY_INLINE_MIN_PX = 640;

function parseCoachUiMessages(raw: unknown): CoachChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m: unknown): m is CoachChatMessage =>
        !!m &&
        typeof m === 'object' &&
        typeof (m as CoachChatMessage).id === 'string' &&
        ((m as CoachChatMessage).role === 'user' ||
          (m as CoachChatMessage).role === 'model') &&
        typeof (m as CoachChatMessage).text === 'string'
    )
    .map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      ...(Array.isArray(m.attachments) && m.attachments.length > 0
        ? { attachments: m.attachments as CoachAttachment[] }
        : {}),
    }));
}

/**
 * Light markdown for coach bubbles (no HTML injection).
 * Supports: headings, bullets, numbered lists, blockquotes, hr, fenced code,
 * **bold** / __bold__, *italic* / _italic_, ~~strike~~, `code`, [links](url), bare https URLs.
 */
function normalizeCoachText(text: string): string {
  let t = text.replace(/\r\n/g, '\n');
  // Model sometimes dumps "1. a 2. b" or "- a - b" on one line.
  if (!t.includes('\n')) {
    t = t
      .replace(/\s+(\d+)\.\s+/g, '\n$1. ')
      .replace(/\s+([*\-•])\s+/g, '\n$1 ');
  }
  return t;
}

const SAFE_HREF_RE = /^https?:\/\//i;

function trimTrailingUrlPunctuation(url: string): { href: string; trailing: string } {
  // Peel trailing ),.], etc. that models often stick to URLs.
  let href = url;
  let trailing = '';
  while (/[),.\]!;:]$/.test(href)) {
    trailing = href.slice(-1) + trailing;
    href = href.slice(0, -1);
  }
  return { href, trailing };
}

/** Inline markdown inside a single line / list item. */
function CoachTextSegment({ text, keyPrefix }: { text: string; keyPrefix: string }) {
  const nodes: React.ReactNode[] = [];

  // 1) Extract markdown links + inline code + bare URLs as atomic tokens.
  const tokenRe =
    /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|`[^`]+`|https?:\/\/[^\s<>\)\]"'`]+)/g;
  const chunks = text.split(tokenRe);

  const pushEmphasis = (raw: string, keyBase: string) => {
    // Order: ***bold-italic*** / **bold** / __bold__ / *italic* / _italic_ / ~~strike~~
    const parts = raw.split(
      /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~)/g
    );
    parts.forEach((part, partIdx) => {
      if (!part) return;
      let m: RegExpExecArray | null;
      if ((m = /^\*\*\*([^*]+)\*\*\*$/.exec(part))) {
        nodes.push(
          <strong key={`${keyBase}_${partIdx}`} className="font-semibold text-[#F5F5F5]">
            <em className="italic">{m[1]}</em>
          </strong>
        );
        return;
      }
      if ((m = /^\*\*([^*]+)\*\*$/.exec(part)) || (m = /^__([^_]+)__$/.exec(part))) {
        nodes.push(
          <strong
            key={`${keyBase}_${partIdx}`}
            className="font-semibold text-[#F5F5F5]"
          >
            {m[1]}
          </strong>
        );
        return;
      }
      if ((m = /^\*([^*]+)\*$/.exec(part)) || (m = /^_([^_]+)_$/.exec(part))) {
        nodes.push(
          <em
            key={`${keyBase}_${partIdx}`}
            className="italic text-[#A0A0A8]"
          >
            {m[1]}
          </em>
        );
        return;
      }
      if ((m = /^~~([^~]+)~~$/.exec(part))) {
        nodes.push(
          <span
            key={`${keyBase}_${partIdx}`}
            className="line-through text-[#6B7280]"
          >
            {m[1]}
          </span>
        );
        return;
      }
      nodes.push(
        <React.Fragment key={`${keyBase}_${partIdx}`}>{part}</React.Fragment>
      );
    });
  };

  chunks.forEach((chunk, i) => {
    if (!chunk) return;

    const linkMatch = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(chunk);
    if (linkMatch && SAFE_HREF_RE.test(linkMatch[2])) {
      nodes.push(
        <a
          key={`${keyPrefix}_a_${i}`}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-teal-500/50 text-teal-300 hover:text-teal-200"
        >
          {linkMatch[1]}
        </a>
      );
      return;
    }

    const inlineCode = /^`([^`]+)`$/.exec(chunk);
    if (inlineCode) {
      nodes.push(
        <code
          key={`${keyPrefix}_c_${i}`}
          className="rounded-md bg-slate-950/90 border border-slate-700/70 px-1 py-0.5 font-mono text-[11px] text-teal-200/90"
        >
          {inlineCode[1]}
        </code>
      );
      return;
    }

    if (/^https?:\/\//.test(chunk)) {
      const { href, trailing } = trimTrailingUrlPunctuation(chunk);
      if (SAFE_HREF_RE.test(href)) {
        nodes.push(
          <a
            key={`${keyPrefix}_u_${i}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-teal-500/50 text-teal-300 hover:text-teal-200 break-all"
          >
            {href}
          </a>
        );
        if (trailing) {
          nodes.push(
            <React.Fragment key={`${keyPrefix}_ut_${i}`}>{trailing}</React.Fragment>
          );
        }
        return;
      }
    }

    pushEmphasis(chunk, `${keyPrefix}_${i}`);
  });

  return <>{nodes}</>;
}

type CoachTextBlock =
  | { type: 'paragraph'; lines: string[] }
  | { type: 'bullets'; items: string[] }
  | { type: 'numbered'; items: string[] }
  | { type: 'heading'; text: string; level: number }
  | { type: 'code'; lang: string | null; code: string }
  | { type: 'quote'; lines: string[] }
  | { type: 'hr' };

function parseCoachBlocks(text: string): CoachTextBlock[] {
  const lines = normalizeCoachText(text).split('\n');
  const blocks: CoachTextBlock[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];
  let numbered: string[] = [];
  let quote: string[] = [];
  let inCode = false;
  let codeLang: string | null = null;
  let codeLines: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', lines: paragraph });
    paragraph = [];
  };
  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push({ type: 'bullets', items: bullets });
    bullets = [];
  };
  const flushNumbered = () => {
    if (numbered.length === 0) return;
    blocks.push({ type: 'numbered', items: numbered });
    numbered = [];
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    blocks.push({ type: 'quote', lines: quote });
    quote = [];
  };
  const flushLists = () => {
    flushBullets();
    flushNumbered();
    flushQuote();
  };
  const flushCode = () => {
    blocks.push({ type: 'code', lang: codeLang, code: codeLines.join('\n') });
    inCode = false;
    codeLang = null;
    codeLines = [];
  };

  for (const raw of lines) {
    const fence = /^\s{0,3}```\s*([A-Za-z0-9_+-]*)\s*$/.exec(raw);
    if (fence) {
      if (inCode) {
        flushCode();
      } else {
        flushLists();
        flushParagraph();
        inCode = true;
        codeLang = fence[1] ? fence[1].toLowerCase() : null;
        codeLines = [];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(raw);
      continue;
    }

    if (/^\s{0,3}([-*_])\1{2,}\s*$/.test(raw)) {
      flushLists();
      flushParagraph();
      blocks.push({ type: 'hr' });
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (heading) {
      flushLists();
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        text: heading[2].trim(),
      });
      continue;
    }

    const quoteLine = /^\s{0,3}>\s?(.*)$/.exec(raw);
    if (quoteLine) {
      flushBullets();
      flushNumbered();
      flushParagraph();
      quote.push(quoteLine[1]);
      continue;
    }

    const bullet = /^\s{0,3}[\*\-•]\s+(.+)$/.exec(raw);
    if (bullet) {
      flushNumbered();
      flushQuote();
      flushParagraph();
      bullets.push(bullet[1]);
      continue;
    }

    const num = /^\s{0,3}\d+[.)]\s+(.+)$/.exec(raw);
    if (num) {
      flushBullets();
      flushQuote();
      flushParagraph();
      numbered.push(num[1]);
      continue;
    }

    if (raw.trim() === '') {
      flushLists();
      flushParagraph();
      continue;
    }

    flushLists();
    paragraph.push(raw);
  }
  if (inCode) flushCode();
  flushLists();
  flushParagraph();
  return blocks;
}

function CoachMessageBody({ text }: { text: string }) {
  const blocks = parseCoachBlocks(text);

  return (
    <div className="space-y-2.5">
      {blocks.map((block, blockIdx) => {
        if (block.type === 'hr') {
          return (
            <hr
              key={`hr_${blockIdx}`}
              className="border-0 border-t border-slate-700/70 my-1"
            />
          );
        }
        if (block.type === 'code') {
          return (
            <div
              key={`c_${blockIdx}`}
              className="my-1 overflow-x-auto rounded-xl border border-slate-700/80 bg-slate-950/90"
            >
              {block.lang && (
                <div className="px-3 pt-2 text-[9px] font-semibold uppercase tracking-wider text-[#6B7280]">
                  {block.lang}
                </div>
              )}
              <pre className="m-0 px-3 py-2.5 overflow-x-auto">
                <code className="block font-mono text-[11px] leading-[1.5] text-teal-100/90 whitespace-pre">
                  {block.code}
                </code>
              </pre>
            </div>
          );
        }
        if (block.type === 'heading') {
          return (
            <p
              key={`h_${blockIdx}`}
              className={cn(
                'm-0 font-semibold text-[#F5F5F5] leading-[1.4]',
                block.level <= 2 ? 'text-[14px]' : 'text-[13px]'
              )}
            >
              <CoachTextSegment text={block.text} keyPrefix={`h${blockIdx}`} />
            </p>
          );
        }
        if (block.type === 'quote') {
          return (
            <blockquote
              key={`q_${blockIdx}`}
              className="m-0 border-l-2 border-teal-500/40 pl-3 text-[#A0A0A8]"
            >
              {block.lines.map((line, lineIdx) => (
                <p key={`q_${blockIdx}_${lineIdx}`} className="m-0 mb-1 last:mb-0">
                  <CoachTextSegment
                    text={line}
                    keyPrefix={`ql${blockIdx}_${lineIdx}`}
                  />
                </p>
              ))}
            </blockquote>
          );
        }
        if (block.type === 'bullets') {
          return (
            <ul
              key={`b_${blockIdx}`}
              className="m-0 pl-0 list-none space-y-1.5"
            >
              {block.items.map((item, itemIdx) => {
                const labeled = /^([^:]{2,72}):\s+(.+)$/.exec(item);
                const display = labeled
                  ? `**${labeled[1]}:** ${labeled[2]}`
                  : item;
                return (
                  <li
                    key={`b_${blockIdx}_${itemIdx}`}
                    className="flex gap-2 min-w-0"
                  >
                    <span
                      className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-teal-400/80"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <CoachTextSegment
                        text={display}
                        keyPrefix={`bi${blockIdx}_${itemIdx}`}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          );
        }
        if (block.type === 'numbered') {
          return (
            <ol
              key={`n_${blockIdx}`}
              className="m-0 pl-0 list-none space-y-1.5"
            >
              {block.items.map((item, itemIdx) => (
                <li
                  key={`n_${blockIdx}_${itemIdx}`}
                  className="flex gap-2 min-w-0"
                >
                  <span className="w-4 shrink-0 tabular-nums text-[11px] text-teal-400/90 font-semibold pt-[0.1em]">
                    {itemIdx + 1}.
                  </span>
                  <span className="min-w-0 flex-1">
                    <CoachTextSegment
                      text={item}
                      keyPrefix={`ni${blockIdx}_${itemIdx}`}
                    />
                  </span>
                </li>
              ))}
            </ol>
          );
        }

        return (
          <p key={`p_${blockIdx}`} className="m-0">
            {block.lines.map((line, lineIdx) => (
              <React.Fragment key={`p_${blockIdx}_${lineIdx}`}>
                {lineIdx > 0 && <br />}
                <CoachTextSegment
                  text={line}
                  keyPrefix={`pl${blockIdx}_${lineIdx}`}
                />
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/** Unsplash attribution (required by Unsplash API guidelines). */
function CoachImageAttachmentView({
  attachment,
  onMediaReady,
}: {
  attachment: CoachImageAttachment;
  onMediaReady?: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const profileUrl =
    attachment.photographerProfileUrl || 'https://unsplash.com';
  const name = attachment.photographerName || 'Unknown';

  return (
    <div className="mt-3 w-full min-w-0">
      <div className="rounded-2xl border border-slate-700/70 bg-slate-950/80 p-1.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.5)]">
        {!broken ? (
          <img
            src={attachment.imageUrl}
            alt=""
            loading="lazy"
            className="block w-full max-w-full h-auto rounded-[12px]"
            onLoad={() => onMediaReady?.()}
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="w-full h-28 rounded-[12px] bg-slate-900/80 flex items-center justify-center text-[10px] text-[#6B7280]">
            Image unavailable
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[8px] leading-normal text-[#6B7280]">
        Photo by{' '}
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-[#6B7280]/60 text-[#A0A0A8] hover:text-teal-400"
        >
          {name}
        </a>{' '}
        on{' '}
        <a
          href="https://unsplash.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-[#6B7280]/60 text-[#A0A0A8] hover:text-teal-400"
        >
          Unsplash
        </a>
      </p>
    </div>
  );
}

/** Pexels video attribution (curated clips). */
function CoachVideoAttachmentView({
  attachment,
  onMediaReady,
}: {
  attachment: CoachVideoAttachment;
  onMediaReady?: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const profileUrl =
    attachment.photographerProfileUrl || 'https://www.pexels.com';
  const name = attachment.photographerName || 'Unknown';

  return (
    <div className="mt-3 w-full min-w-0">
      <div className="rounded-2xl border border-slate-700/70 bg-slate-950/80 p-1.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.5)]">
        {!broken ? (
          <video
            src={attachment.videoUrl}
            controls
            muted
            playsInline
            preload="metadata"
            className="block w-full max-w-full h-auto rounded-[12px] bg-black"
            onLoadedData={() => onMediaReady?.()}
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="w-full h-28 rounded-[12px] bg-slate-900/80 flex items-center justify-center text-[10px] text-[#6B7280]">
            Video unavailable
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[8px] leading-normal text-[#6B7280]">
        Video by{' '}
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-[#6B7280]/60 text-[#A0A0A8] hover:text-teal-400"
        >
          {name}
        </a>{' '}
        on{' '}
        <a
          href="https://www.pexels.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-[#6B7280]/60 text-[#A0A0A8] hover:text-teal-400"
        >
          Pexels
        </a>
      </p>
    </div>
  );
}

/** Official YouTube embed + title/channel attribution. */
function CoachYouTubeAttachmentView({
  attachment,
  onMediaReady,
}: {
  attachment: CoachYouTubeAttachment;
  onMediaReady?: () => void;
}) {
  const title = attachment.title || 'YouTube video';
  const channel = attachment.channelTitle || 'YouTube';
  const embedSrc = `https://www.youtube.com/embed/${encodeURIComponent(attachment.videoId)}`;

  return (
    <div className="mt-3 w-full min-w-0">
      <div className="rounded-2xl border border-slate-700/70 bg-slate-950/80 p-1.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.5)] overflow-hidden">
        <div className="relative w-full aspect-video rounded-[12px] overflow-hidden bg-black">
          <iframe
            src={embedSrc}
            title={title}
            className="absolute inset-0 w-full h-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            loading="lazy"
            onLoad={() => onMediaReady?.()}
          />
        </div>
      </div>
      <p className="mt-1.5 text-[8px] leading-normal text-[#6B7280] line-clamp-2">
        <span className="text-[#A0A0A8]">{title}</span>
        {' · '}
        {channel} on{' '}
        <a
          href={`https://www.youtube.com/watch?v=${encodeURIComponent(attachment.videoId)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-[#6B7280]/60 text-[#A0A0A8] hover:text-teal-400"
        >
          YouTube
        </a>
      </p>
    </div>
  );
}

/** Safe Amazon search chip (URL always built server-side as /s?k=). */
function CoachShoppingLinkAttachmentView({
  attachment,
}: {
  attachment: CoachShoppingLinkAttachment;
}) {
  const query = attachment.searchQuery?.trim() || 'gear';
  const retailer = attachment.retailer || 'Amazon';
  const label = `Search ${query} on ${retailer}`;

  return (
    <div className="mt-3 w-full min-w-0">
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex max-w-full items-center gap-2 rounded-xl border border-teal-500/35 bg-teal-500/10 px-3.5 py-2.5 text-[12px] font-semibold text-teal-300 hover:bg-teal-500/20 hover:text-teal-200 transition-colors"
      >
        <Search size={14} className="shrink-0 opacity-90" strokeWidth={2.5} />
        <span className="truncate">{label}</span>
      </a>
      <p className="mt-1.5 text-[8px] leading-normal text-[#6B7280]">
        Opens Amazon search results — not a specific product recommendation.
      </p>
    </div>
  );
}

/** Google Search grounding citations (required attribution) — clearly clickable. */
function CoachSourcesAttachmentView({
  attachment,
}: {
  attachment: CoachSourcesAttachment;
}) {
  const seen = new Set<string>();
  const sources = (Array.isArray(attachment.sources) ? attachment.sources : [])
    .filter((s) => s && typeof s.url === 'string' && s.url.trim())
    .filter((s) => {
      const title = (
        typeof s.title === 'string' && s.title.trim() ? s.title.trim() : s.url
      )
        .toLowerCase()
        .replace(/^www\./, '');
      if (!title || seen.has(title)) return false;
      seen.add(title);
      return true;
    });
  if (sources.length === 0) return null;

  return (
    <div className="mt-2.5 w-full min-w-0">
      <p className="text-[9px] leading-normal text-[#6B7280] mb-1">Sources:</p>
      <ul className="space-y-1 list-none p-0 m-0">
        {sources.map((s, idx) => {
          const title =
            typeof s.title === 'string' && s.title.trim()
              ? s.title.trim()
              : s.url;
          return (
            <li key={`${title}_${idx}`} className="min-w-0">
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-baseline gap-1 text-[10px] leading-snug underline decoration-[#6B7280]/70 text-[#A0A0A8] hover:text-teal-400 break-all"
              >
                <span className="truncate">{title}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CoachAttachmentView({
  attachment,
  onMediaReady,
}: {
  attachment: CoachAttachment;
  onMediaReady?: () => void;
}) {
  if (attachment.type === 'video_youtube') {
    return (
      <CoachYouTubeAttachmentView
        attachment={attachment}
        onMediaReady={onMediaReady}
      />
    );
  }
  if (attachment.type === 'video') {
    return (
      <CoachVideoAttachmentView
        attachment={attachment}
        onMediaReady={onMediaReady}
      />
    );
  }
  if (attachment.type === 'shopping_link') {
    return <CoachShoppingLinkAttachmentView attachment={attachment} />;
  }
  if (attachment.type === 'sources') {
    return <CoachSourcesAttachmentView attachment={attachment} />;
  }
  return (
    <CoachImageAttachmentView
      attachment={attachment}
      onMediaReady={onMediaReady}
    />
  );
}

/**
 * AI Coach layout panel — text chat (function calling) or Voice & Video (Live API).
 * Mounted inside a resizable Panel (desktop/mobile); not an overlay drawer.
 */
const AiCoachPanel: React.FC<AiCoachPanelProps> = ({
  onClose,
  presentation = 'embedded',
}) => {
  const isFullscreen = presentation === 'fullscreen';
  const currentUser = useStore(s => s.currentUser);
  const vitals = useStore(s => s.vitals);
  const hasRealData = useStore(s => s.hasRealData);
  const isConnected = useStore(s => s.isConnected);
  const isSimulatedStream = useStore(s => s.isSimulatedStream);
  // Coach must not treat STALE / DEMO numbers as live coaching inputs.
  const liveForCoach = hasRealData && isConnected && !isSimulatedStream;

  const [interactionMode, setInteractionMode] =
    useState<CoachInteractionMode>('text');
  const [messages, setMessages] = useState<CoachChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [startingNew, setStartingNew] = useState(false);
  /** Fetching active session from GET /api/coach/session on panel mount. */
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionLimitReached, setSessionLimitReached] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState(false);
  /** History sidebar visibility (toggle via header). */
  const [historyOpen, setHistoryOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  const historyInline = panelWidth >= HISTORY_INLINE_MIN_PX;
  const historyInlineRef = useRef(historyInline);
  historyInlineRef.current = historyInline;

  const closeHistoryIfOverlay = () => {
    if (!historyInlineRef.current) setHistoryOpen(false);
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number') setPanelWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!historyOpen || historyInline) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHistoryOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [historyOpen, historyInline]);
  const [sessionList, setSessionList] = useState<CoachSessionListItem[]>([]);
  const [sessionListLoading, setSessionListLoading] = useState(false);
  const [sessionListLoadingMore, setSessionListLoadingMore] = useState(false);
  const [sessionListNextBefore, setSessionListNextBefore] = useState<
    number | null
  >(null);
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const voiceModeRef = useRef(false);
  const loadingRef = useRef(false);
  const prevSpeakingRef = useRef(false);
  /** Keep chat pinned to latest messages unless the user scrolls up to read history. */
  const stickToBottomRef = useRef(true);
  const sendMessageRef = useRef<(text?: string) => Promise<void>>(
    async () => {}
  );
  const sessionIdRef = useRef<string | null>(null);
  /** Blank thread with no server doc yet; first /message sends newSession: true. */
  const draftNewSessionRef = useRef(false);

  voiceModeRef.current = voiceMode;
  loadingRef.current = loading;
  sessionIdRef.current = sessionId;

  const authHeaders = async (): Promise<Record<string, string> | null> => {
    if (!currentUser || typeof currentUser.getIdToken !== 'function') {
      return null;
    }
    const token = await currentUser.getIdToken();
    return { Authorization: `Bearer ${token}` };
  };

  const refreshSessionList = async (opts?: { append?: boolean }) => {
    const append = opts?.append === true;
    const headers = await authHeaders();
    if (!headers) return;

    if (append) {
      if (sessionListNextBefore == null) return;
      setSessionListLoadingMore(true);
    } else {
      setSessionListLoading(true);
    }

    try {
      const qs = new URLSearchParams({ limit: '20' });
      if (append && sessionListNextBefore != null) {
        qs.set('before', String(sessionListNextBefore));
      }
      const res = await fetch(`${API_BASE}/api/coach/sessions?${qs}`, {
        method: 'GET',
        headers,
      });
      if (!res.ok) {
        console.warn('[AiCoach] sessions list failed:', res.status);
        return;
      }
      const data = await res.json().catch(() => ({}));
      const items: CoachSessionListItem[] = Array.isArray(data.sessions)
        ? data.sessions.filter(
            (s: unknown): s is CoachSessionListItem =>
              !!s &&
              typeof s === 'object' &&
              typeof (s as CoachSessionListItem).sessionId === 'string'
          )
        : [];
      setSessionList((prev) => (append ? [...prev, ...items] : items));
      setSessionListNextBefore(
        typeof data.nextBefore === 'number' ? data.nextBefore : null
      );
    } catch (err) {
      console.warn('[AiCoach] sessions list error:', err);
    } finally {
      setSessionListLoading(false);
      setSessionListLoadingMore(false);
    }
  };

  /**
   * Open a specific thread from the history sidebar. Explicit sessionId is
   * kept in state so /message prefers this thread over idle auto-pick.
   */
  const openSessionFromHistory = async (id: string) => {
    if (openingSessionId || loading || startingNew) return;
    if (id === sessionId && messages.length > 0) {
      closeHistoryIfOverlay();
      return;
    }

    const headers = await authHeaders();
    if (!headers) {
      setError('Sign in required to chat with the AI Coach.');
      return;
    }

    setOpeningSessionId(id);
    setError(null);
    stopListening();
    cancelSpeech();

    try {
      const res = await fetch(
        `${API_BASE}/api/coach/sessions/${encodeURIComponent(id)}`,
        { method: 'GET', headers }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn('[AiCoach] open session failed:', res.status);
        setError('Could not open that conversation.');
        return;
      }
      const session = data?.session;
      if (!session || typeof session.sessionId !== 'string') {
        setError('Could not open that conversation.');
        return;
      }
      const hydrated = parseCoachUiMessages(session.messages);
      setSessionId(session.sessionId);
      setMessages(hydrated);
      setSessionLimitReached(hydrated.length >= COACH_SESSION_MESSAGE_CAP);
      setInput('');
      setVoiceDraft(false);
      stickToBottomRef.current = true;
      closeHistoryIfOverlay();
    } catch (err) {
      console.warn('[AiCoach] open session error:', err);
      setError('Could not open that conversation.');
    } finally {
      setOpeningSessionId(null);
    }
  };

  /**
   * Bootstrap: on mount, ask the server for the active coach session (same
   * getActiveSession / idle rules as /message). Hydrate messages if present;
   * on null / failure, leave the chat empty — never block sending.
   * History sidebar is loaded in parallel (does not replace bootstrap).
   */
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      if (!currentUser || typeof currentUser.getIdToken !== 'function') {
        if (!cancelled) setHistoryLoading(false);
        return;
      }

      setHistoryLoading(true);
      void refreshSessionList();

      try {
        const token = await currentUser.getIdToken();
        const res = await fetch(`${API_BASE}/api/coach/session`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          console.warn('[AiCoach] session bootstrap failed:', res.status);
          return;
        }

        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        const session = data?.session;
        if (!session || typeof session.sessionId !== 'string') {
          // No active session (idle closed / never started) — empty chat.
          return;
        }

        const hydrated = parseCoachUiMessages(session.messages);
        setSessionId(session.sessionId);
        setMessages(hydrated);
        setSessionLimitReached(hydrated.length >= COACH_SESSION_MESSAGE_CAP);
        stickToBottomRef.current = true;
      } catch (err) {
        // Network / offline — fall back to empty chat; do not alarm the user.
        console.warn('[AiCoach] session bootstrap error:', err);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / uid only
  }, [currentUser?.uid]);

  const scrollChatToBottom = () => {
    const el = listRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  };

  const onChatListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 120;
  };

  const { speak, isSpeaking, cancel: cancelSpeech, isSupported: ttsSupported } =
    useVoiceOutput();

  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    isSupported: sttSupported,
  } = useVoiceInput({
    onFinalTranscript: (text) => {
      stopListening();
      setVoiceDraft(false);
      setInput('');
      void sendMessageRef.current(text);
    },
    onIdleTimeout: () => {
      setVoiceMode(false);
      voiceModeRef.current = false;
      setVoiceDraft(false);
      setInput('');
    },
  });

  const voiceSupported = sttSupported && ttsSupported;

  const resizeComposer = () => {
    const el = inputRef.current;
    if (!el) return;
    // Force a reflow so scrollHeight is correct for live STT (readOnly + rapid updates).
    el.style.height = '0px';
    // Embedded stays shorter; while dictating allow more lines so text isn't clipped.
    const dictating = voiceMode || voiceDraft;
    const maxPx = isFullscreen
      ? dictating
        ? 10 * 16
        : 6.25 * 16
      : dictating
        ? 7.5 * 16
        : 3.25 * 16;
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
  };

  useEffect(() => {
    if (interactionMode !== 'text') return;
    const t = window.setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
      resizeComposer();
    }, 200);
    return () => window.clearTimeout(t);
  }, [interactionMode]);

  // Sync height after React commits input (typing + live STT).
  useLayoutEffect(() => {
    if (interactionMode !== 'text') return;
    resizeComposer();
  }, [input, voiceMode, voiceDraft, isListening, interactionMode, isFullscreen]);

  useEffect(() => {
    if (voiceMode && stickToBottomRef.current) {
      scrollChatToBottom();
    }
  }, [input, voiceMode, isListening]);

  useLayoutEffect(() => {
    if (interactionMode !== 'text') return;
    // Follow new Q&A / thinking indicator. Stick ref is true after send /
    // while near bottom; measuring after content grows used to skip scroll.
    scrollChatToBottom();
    const id = requestAnimationFrame(() => scrollChatToBottom());
    return () => cancelAnimationFrame(id);
  }, [messages, loading, historyLoading, interactionMode]);

  // Live interim transcript into the composer while listening.
  useEffect(() => {
    if (!voiceMode || !isListening) return;
    setInput(transcript);
    setVoiceDraft(true);
  }, [transcript, isListening, voiceMode]);

  // Tear down STT/TTS when leaving text mode or unmounting.
  useEffect(() => {
    if (interactionMode === 'text') return;
    setVoiceMode(false);
    voiceModeRef.current = false;
    stopListening();
    cancelSpeech();
    setVoiceDraft(false);
  }, [interactionMode, stopListening, cancelSpeech]);

  useEffect(() => {
    return () => {
      stopListening();
      cancelSpeech();
    };
  }, [stopListening, cancelSpeech]);

  const selectInteractionMode = (mode: CoachInteractionMode) => {
    // Switching away from Voice & Video unmounts LiveCoachSessionView →
    // useLiveCoachSession cleanup stops cam/mic/WS.
    setInteractionMode(mode);
  };

  // After coach finishes speaking, resume listening if voice mode is still on.
  useEffect(() => {
    const wasSpeaking = prevSpeakingRef.current;
    prevSpeakingRef.current = isSpeaking;
    if (
      wasSpeaking &&
      !isSpeaking &&
      voiceModeRef.current &&
      !loadingRef.current &&
      !sessionLimitReached
    ) {
      inputRef.current?.blur();
      startListening();
    }
  }, [isSpeaking, sessionLimitReached, startListening]);

  const buildMetricsSnapshot = () => {
    const recovery = getRecoveryScore(vitals, liveForCoach);
    return {
      heartRate: vitals.heartRate.value,
      spo2: vitals.spo2.value,
      respirationRate: vitals.respirationRate.value,
      temperature: vitals.temperature.value,
      hrvProxyMs: getHrvProxyMs(vitals.heartRate.value, liveForCoach),
      recoveryScore: recovery.score,
      hasRealData: liveForCoach,
    };
  };

  const resumeVoiceListening = () => {
    if (!voiceModeRef.current || sessionLimitReached) return;
    inputRef.current?.blur();
    window.setTimeout(() => startListening(), 80);
  };

  const startNewConversation = async () => {
    if (startingNew || loading || historyLoading) return;

    if (!currentUser || typeof currentUser.getIdToken !== 'function') {
      setError('Sign in required to chat with the AI Coach.');
      return;
    }

    setStartingNew(true);
    setError(null);
    // Clear selected thread before creating a new one so a failed request
    // cannot leave a stale sessionId pointing at the previous conversation.
    setSessionId(null);
    setMessages([]);
    setSessionLimitReached(false);
    stopListening();
    cancelSpeech();

    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_BASE}/api/coach/new-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ metricsSnapshot: buildMetricsSnapshot() }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(
          data?.error === 'unauthorized'
            ? 'Session expired — sign in again.'
            : 'Could not start a new conversation.'
        );
        return;
      }

      setInput('');
      setVoiceDraft(false);
      stickToBottomRef.current = true;
      window.setTimeout(() => resizeComposer(), 0);
      if (typeof data.sessionId === 'string') {
        setSessionId(data.sessionId);
      } else {
        setSessionId(null);
      }
      void refreshSessionList();
      // Don't focus the composer in voice mode — that opens the soft keyboard
      // and makes the chat pane jump while listening.
      if (!voiceModeRef.current) {
        window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 100);
      }
      resumeVoiceListening();
    } catch {
      setError('Network error — could not start a new conversation.');
    } finally {
      setStartingNew(false);
    }
  };

  const enterDraftConversation = () => {
    draftNewSessionRef.current = true;
    setSessionId(null);
    sessionIdRef.current = null;
    setMessages([]);
    setSessionLimitReached(false);
    setInput('');
    setVoiceDraft(false);
    stopListening();
    cancelSpeech();
  };

  /**
   * Delete a thread from the history sidebar (server does the recursive
   * Firestore delete). The row is only removed after the server confirms,
   * so a failed delete never looks like it succeeded.
   */
  const deleteSessionFromHistory = async (id: string) => {
    if (deletingSessionId || loading || startingNew) return;

    const confirmed = window.confirm(
      "Delete this conversation? This can't be undone."
    );
    if (!confirmed) return;

    const headers = await authHeaders();
    if (!headers) {
      setError('Sign in required to chat with the AI Coach.');
      return;
    }

    setDeletingSessionId(id);
    setHistoryError(null);

    try {
      const res = await fetch(
        `${API_BASE}/api/coach/sessions/${encodeURIComponent(id)}`,
        { method: 'DELETE', headers }
      );
      const data = await res.json().catch(() => ({}));

      // Only an explicit confirmation counts. A bare 404 { error: 'not_found' }
      // means the server has no DELETE route (stale deploy) — nothing was deleted.
      const confirmed =
        res.ok && data?.deleted === true && data?.sessionId === id;
      const alreadyGone =
        res.status === 404 && data?.error === 'session_not_found';

      if (!confirmed && !alreadyGone) {
        console.warn('[AiCoach] delete session failed:', res.status, data);
        setHistoryError('Could not delete that conversation. Try again.');
        return;
      }

      if (alreadyGone) {
        console.warn('[AiCoach] delete: session already missing on server:', id);
        await refreshSessionList();
      } else {
        setSessionList((prev) => prev.filter((s) => s.sessionId !== id));
      }

      if (sessionIdRef.current === id) {
        // Blank draft, no server call: the session doc is created by the first
        // /message (newSession: true). Eagerly calling new-session here left an
        // empty coachSessions doc behind every time an open thread was deleted.
        enterDraftConversation();
      }
    } catch (err) {
      console.warn('[AiCoach] delete session error:', err);
      setHistoryError('Network error — could not delete that conversation.');
    } finally {
      setDeletingSessionId(null);
    }
  };

  const sendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading || startingNew || historyLoading || sessionLimitReached) return;

    if (!currentUser || typeof currentUser.getIdToken !== 'function') {
      setError('Sign in required to chat with the AI Coach.');
      return;
    }

    // Never listen while waiting for the coach reply.
    stopListening();
    setVoiceDraft(false);
    setError(null);
    setInput('');
    stickToBottomRef.current = true;
    window.setTimeout(() => resizeComposer(), 0);
    // Keep caret in the composer after send (Enter or click) — unless voice mode.
    if (!voiceModeRef.current) {
      window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
    }

    const userMsg: CoachChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      text,
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    const startsNewSession = !sessionIdRef.current && draftNewSessionRef.current;

    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_BASE}/api/coach/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          metricsSnapshot: buildMetricsSnapshot(),
          // When the UI has an open thread (bootstrap or history pick), send it
          // so the server appends to that doc instead of idle auto-pick.
          ...(sessionIdRef.current ? { sessionId: sessionIdRef.current } : {}),
          ...(startsNewSession ? { newSession: true } : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data?.error === 'session_not_found') {
          enterDraftConversation();
          setError('This conversation was deleted. Send your message again to start a new one.');
          void refreshSessionList();
          return;
        }

        if (data?.error === 'session_limit_reached') {
          setSessionLimitReached(true);
          setError(
            data.message ||
              'This coaching session has reached its message limit. Please start a new conversation.'
          );
          setVoiceMode(false);
          voiceModeRef.current = false;
          return;
        }

        const msg =
          data?.error === 'unauthorized' ? 'Session expired — sign in again.' :
          data?.error === 'missing_message' ? 'Message was empty.' :
          data?.error === 'coach_failed' ? 'Coach could not reply. Try again.' :
          'Could not reach the AI Coach.';
        setError(msg);
        resumeVoiceListening();
        return;
      }

      setSessionLimitReached(false);

      if (typeof data.sessionId === 'string') {
        setSessionId(data.sessionId);
        sessionIdRef.current = data.sessionId;
        if (startsNewSession) {
          draftNewSessionRef.current = false;
          void refreshSessionList();
        }
      }

      const replyText =
        typeof data.reply === 'string' && data.reply.trim()
          ? data.reply.trim()
          : 'No reply from coach.';

      const attachments: CoachAttachment[] = Array.isArray(data.attachments)
        ? data.attachments
            .filter((a: unknown): a is CoachAttachment => {
              if (!a || typeof a !== 'object') return false;
              const att = a as CoachAttachment;
              if (att.type === 'image') {
                return (
                  typeof att.imageUrl === 'string' && !!att.imageUrl
                );
              }
              if (att.type === 'video') {
                return (
                  typeof att.videoUrl === 'string' && !!att.videoUrl
                );
              }
              if (att.type === 'video_youtube') {
                return (
                  typeof att.videoId === 'string' && !!att.videoId
                );
              }
              if (att.type === 'shopping_link') {
                return (
                  typeof att.url === 'string' &&
                  /^https:\/\/www\.amazon\.(com|com\.mx|ca|co\.uk)\/s\?k=/.test(
                    att.url
                  )
                );
              }
              if (att.type === 'sources') {
                return (
                  Array.isArray(att.sources) &&
                  att.sources.some(
                    (s) =>
                      s &&
                      typeof s.url === 'string' &&
                      s.url.trim().length > 0
                  )
                );
              }
              return false;
            })
            .map((a: CoachAttachment) => {
              if (a.type === 'video_youtube') {
                return {
                  type: 'video_youtube' as const,
                  videoId: a.videoId,
                  title:
                    typeof a.title === 'string' ? a.title : 'YouTube video',
                  channelTitle:
                    typeof a.channelTitle === 'string'
                      ? a.channelTitle
                      : 'YouTube',
                };
              }
              if (a.type === 'video') {
                return {
                  type: 'video' as const,
                  videoUrl: a.videoUrl,
                  photographerName:
                    typeof a.photographerName === 'string'
                      ? a.photographerName
                      : 'Unknown',
                  photographerProfileUrl:
                    typeof a.photographerProfileUrl === 'string'
                      ? a.photographerProfileUrl
                      : 'https://www.pexels.com',
                };
              }
              if (a.type === 'shopping_link') {
                return {
                  type: 'shopping_link' as const,
                  url: a.url,
                  retailer:
                    typeof a.retailer === 'string' ? a.retailer : 'Amazon',
                  searchQuery:
                    typeof a.searchQuery === 'string' ? a.searchQuery : '',
                };
              }
              if (a.type === 'sources') {
                const sources = (Array.isArray(a.sources) ? a.sources : [])
                  .filter(
                    (s): s is { title: string; url: string } =>
                      !!s &&
                      typeof s.url === 'string' &&
                      s.url.trim().length > 0
                  )
                  .map((s) => ({
                    title:
                      typeof s.title === 'string' && s.title.trim()
                        ? s.title.trim()
                        : s.url,
                    url: s.url.trim(),
                  }));
                return { type: 'sources' as const, sources };
              }
              return {
                type: 'image' as const,
                imageUrl: a.imageUrl,
                photographerName:
                  typeof a.photographerName === 'string'
                    ? a.photographerName
                    : 'Unknown',
                photographerProfileUrl:
                  typeof a.photographerProfileUrl === 'string'
                    ? a.photographerProfileUrl
                    : 'https://unsplash.com',
              };
            })
        : [];

      setMessages(prev => [
        ...prev,
        {
          id: `m_${Date.now()}`,
          role: 'model',
          text: replyText,
          attachments,
        },
      ]);

      void refreshSessionList();

      if (voiceModeRef.current) {
        const started = speak(replyText);
        if (!started) resumeVoiceListening();
      }
    } catch {
      setError('Network error — could not reach the coach server.');
      resumeVoiceListening();
    } finally {
      setLoading(false);
      if (!voiceModeRef.current) {
        window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
      }
    }
  };

  sendMessageRef.current = sendMessage;

  const handleVoiceToggle = () => {
    if (!voiceSupported || sessionLimitReached) return;

    // Interrupt coach speech → listen immediately.
    if (isSpeaking) {
      cancelSpeech();
      setVoiceMode(true);
      voiceModeRef.current = true;
      inputRef.current?.blur();
      startListening();
      return;
    }

    // Deactivate voice mode.
    if (voiceMode) {
      setVoiceMode(false);
      voiceModeRef.current = false;
      stopListening();
      cancelSpeech();
      setVoiceDraft(false);
      return;
    }

    // Activate voice mode.
    setVoiceMode(true);
    voiceModeRef.current = true;
    setError(null);
    // Blur so the soft keyboard / viewport chrome doesn't fight STT updates.
    inputRef.current?.blur();
    startListening();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (voiceMode && (isListening || isSpeaking)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const busy = loading || startingNew || historyLoading || !!openingSessionId;
  const voiceState: 'idle' | 'listening' | 'speaking' | 'waiting' =
    isSpeaking
      ? 'speaking'
      : voiceMode && isListening
        ? 'listening'
        : voiceMode
          ? 'waiting'
          : 'idle';

  const historySidebarProps = {
    sessions: sessionList,
    activeSessionId: sessionId,
    listLoading: sessionListLoading,
    loadingMore: sessionListLoadingMore,
    openingSessionId,
    deletingSessionId,
    hasMore: sessionListNextBefore != null,
    onSelect: (id: string) => void openSessionFromHistory(id),
    onDelete: (id: string) => void deleteSessionFromHistory(id),
    onLoadMore: () => void refreshSessionList({ append: true }),
    onNewConversation: () => {
      closeHistoryIfOverlay();
      void startNewConversation();
    },
    newDisabled: busy || !!deletingSessionId,
    newLoading: startingNew,
    deleteDisabled: busy,
    errorMessage: historyError,
    onDismissError: () => setHistoryError(null),
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        'h-full min-h-0 flex flex-col overflow-hidden',
        isFullscreen ? 'bg-black pt-[env(safe-area-inset-top)]' : 'bg-slate-950/95'
      )}
    >
      <div
        className={cn(
          'flex items-center justify-between border-b border-slate-800/80 flex-shrink-0 gap-3',
          isFullscreen ? 'px-4 sm:px-5 pt-4 sm:pt-5 pb-3' : 'px-3 pt-2.5 pb-2'
        )}
      >
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-[0.22em]">
            Performance
          </p>
          <p
            className={cn(
              'font-bold text-[#F5F5F5] mt-0.5 truncate leading-tight',
              isFullscreen ? 'text-base' : 'text-[14px]'
            )}
          >
            AI Coach
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 p-0.5 rounded-xl bg-slate-900/50 border border-slate-800/90">
          {interactionMode === 'text' && (
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              className={cn(
                'flex items-center justify-center gap-1.5 h-9 px-2.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors',
                historyOpen
                  ? 'text-teal-400 bg-teal-500/15'
                  : 'text-[#A0A0A8] hover:bg-teal-500/15 hover:text-teal-400'
              )}
              title={historyOpen ? 'Hide conversations' : 'Show conversations'}
              aria-pressed={historyOpen}
            >
              <PanelLeft size={14} />
              Chats
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-[#A0A0A8] hover:text-[#F5F5F5] hover:bg-slate-800/80 transition-colors"
            aria-label="Close AI Coach"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div
        className={cn(
          'flex-shrink-0',
          isFullscreen ? 'px-4 sm:px-5 pt-3 pb-2' : 'px-3 pt-2 pb-1.5'
        )}
      >
        <div
          className="flex bg-slate-900/60 p-1 rounded-full border border-slate-800/50 gap-1"
          role="group"
          aria-label="Coach interaction mode"
        >
          <button
            type="button"
            onClick={() => selectInteractionMode('text')}
            className={cn(
              'flex-1 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.1em] transition-all',
              interactionMode === 'text'
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-300'
            )}
          >
            Text
          </button>
          <button
            type="button"
            onClick={() => selectInteractionMode('live')}
            className={cn(
              'flex-1 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.1em] transition-all',
              interactionMode === 'live'
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-300'
            )}
          >
            Voice & Video
          </button>
        </div>
      </div>

      {interactionMode === 'live' ? (
        <div
          className={cn(
            'flex-1 min-h-0 flex flex-col overflow-hidden',
            isFullscreen ? 'px-4 sm:px-5 pb-4' : 'px-3 pb-2.5'
          )}
        >
          <LiveCoachSessionView embedded />
        </div>
      ) : (
        <div className="relative flex-1 min-h-0 flex overflow-hidden">
          {historyOpen && historyInline && (
            <CoachHistorySidebar
              {...historySidebarProps}
              className="flex-shrink-0 w-[13.5rem]"
            />
          )}

          <AnimatePresence>
            {historyOpen && !historyInline && (
              <>
                <motion.button
                  key="history-backdrop"
                  type="button"
                  aria-label="Close conversations"
                  onClick={() => setHistoryOpen(false)}
                  className="absolute inset-0 z-20 bg-black/55"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                />
                <motion.div
                  key="history-drawer"
                  className="absolute inset-y-0 left-0 z-30 w-[min(17rem,85%)] flex shadow-2xl shadow-black/60"
                  initial={{ x: '-100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '-100%' }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  <CoachHistorySidebar
                    {...historySidebarProps}
                    className="flex-1 min-w-0 bg-slate-950"
                  />
                </motion.div>
              </>
            )}
          </AnimatePresence>

          <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          <div
            ref={listRef}
            onScroll={onChatListScroll}
            className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-hide px-4 sm:px-5 py-4 flex flex-col gap-3.5"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {(historyLoading || openingSessionId) && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-950/70 backdrop-blur-[2px]">
                <Loader2 size={28} className="animate-spin text-[#A0A0A8]" />
                <p className="text-[11px] text-[#A0A0A8] font-medium">
                  {openingSessionId
                    ? 'Opening conversation…'
                    : 'Loading conversation…'}
                </p>
              </div>
            )}

            {startingNew && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-950/70 backdrop-blur-[2px]">
                <Loader2 size={28} className="animate-spin text-[#A0A0A8]" />
                <p className="text-[11px] text-[#A0A0A8] font-medium">
                  Starting new conversation…
                </p>
              </div>
            )}

            {messages.length === 0 &&
              !loading &&
              !startingNew &&
              !historyLoading &&
              !openingSessionId && (
              <p className="text-[12px] text-[#6B7280] leading-[1.5] px-0.5">
                Ask about training, recovery, hydration, or effort. This is
                performance coaching — not medical advice.
                {voiceSupported && (
                  <>
                    {' '}
                    Tap the mic for hands-free voice mode.
                  </>
                )}
              </p>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  'flex min-w-0 w-full',
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                <div
                  className={cn(
                    'max-w-[85%] min-w-0 px-3.5 py-3 text-[13px] leading-[1.45] break-words [overflow-wrap:anywhere] text-[#F5F5F5]',
                    msg.role === 'user'
                      ? 'bg-slate-700/90 border border-slate-600/50 font-medium rounded-[16px] rounded-br-[4px]'
                      : 'bg-slate-800/70 border border-slate-700/60 rounded-[16px] rounded-bl-[4px]'
                  )}
                  style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                >
                  {msg.role === 'model' ? (
                    <CoachMessageBody text={msg.text} />
                  ) : (
                    msg.text
                  )}
                  {msg.role === 'model' &&
                    Array.isArray(msg.attachments) &&
                    msg.attachments.map((att, idx) => (
                      <CoachAttachmentView
                        key={`${msg.id}_att_${idx}`}
                        attachment={att}
                        onMediaReady={scrollChatToBottom}
                      />
                    ))}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-800/70 border border-slate-700/60 text-[#A0A0A8] text-[12px] px-3.5 py-3 rounded-[16px] rounded-bl-[4px] italic flex items-center gap-2 leading-[1.45]">
                  <Loader2 size={13} className="animate-spin text-[#A0A0A8]" />
                  Coach thinking…
                </div>
              </div>
            )}
          </div>

          <div
            className={cn(
              'flex-shrink-0 border-t border-slate-800/80',
              isFullscreen
                ? 'px-4 sm:px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]'
                : 'px-3 py-2.5'
            )}
          >
            {error && (
              <div className="mb-3 space-y-2">
                <p className="text-[11px] text-rose-400 leading-[1.45]">{error}</p>
                {sessionLimitReached && (
                  <button
                    type="button"
                    onClick={() => void startNewConversation()}
                    disabled={busy}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-teal-500/40 bg-transparent text-[10px] font-bold uppercase tracking-wider text-teal-400 hover:bg-teal-500/10 transition-colors disabled:opacity-40"
                  >
                    {startingNew ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <MessageSquarePlus size={13} />
                    )}
                    {startingNew ? 'Starting…' : 'Start new conversation'}
                  </button>
                )}
              </div>
            )}
            {sessionId && (
              <p className="text-[8px] text-[#6B7280] uppercase tracking-wider mb-2 truncate">
                Session {sessionId}
              </p>
            )}
            {/* Fixed-height status slot — never grow/wrap or the chat scrollbar flashes */}
            <div className="h-4 mb-2 overflow-hidden">
              {voiceMode && (
                <p className="text-[9px] text-teal-400/80 tracking-wide truncate leading-4">
                  {voiceState === 'listening' && 'Listening…'}
                  {voiceState === 'speaking' && 'Coach speaking — tap mic to interrupt'}
                  {voiceState === 'waiting' && 'Waiting for coach…'}
                </p>
              )}
            </div>
            <div className="flex items-end gap-2.5">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  setVoiceDraft(false);
                  setInput(e.target.value);
                }}
                onFocus={() => {
                  // Keep the document pinned; MobileApp owns visualViewport layout.
                  window.scrollTo(0, 0);
                }}
                onKeyDown={onKeyDown}
                readOnly={
                  historyLoading ||
                  startingNew ||
                  sessionLimitReached ||
                  (voiceMode && isListening) ||
                  isSpeaking
                }
                disabled={sessionLimitReached || startingNew || historyLoading}
                placeholder={
                  historyLoading
                    ? 'Loading conversation…'
                    : sessionLimitReached
                    ? 'Start a new conversation to continue…'
                    : voiceState === 'listening'
                      ? 'Listening…'
                      : 'Ask your coach…'
                }
                className={cn(
                  'flex-1 min-w-0 resize-none overflow-y-auto scrollbar-hide bg-slate-900/80 border border-slate-700/80 rounded-2xl px-3.5 py-2.5 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/25 shadow-[inset_0_1px_0_rgba(245,245,245,0.04)] placeholder:text-[#6B7280] disabled:opacity-50 leading-[1.45] transition-[border-color,box-shadow]',
                  // 16px always — avoids iOS zoom that blows up the mobile split layout
                  'text-base',
                  // Taller while dictating so long STT drafts stay readable
                  voiceMode || voiceDraft
                    ? isFullscreen
                      ? 'max-h-[10rem]'
                      : 'max-h-[7.5rem]'
                    : isFullscreen
                      ? 'max-h-[6.25rem]'
                      : 'max-h-[3.25rem]',
                  // readOnly (not disabled) while listening so the box can grow with STT text
                  ((voiceMode && isListening) || isSpeaking) &&
                    'cursor-default opacity-90',
                  voiceDraft
                    ? 'text-[#A0A0A8] italic'
                    : 'text-[#F5F5F5]'
                )}
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              />
              <button
                type="button"
                onClick={handleVoiceToggle}
                disabled={!voiceSupported || sessionLimitReached}
                className={cn(
                  'relative w-11 h-11 flex items-center justify-center rounded-2xl shrink-0 overflow-hidden transition-all disabled:opacity-35',
                  voiceState === 'listening' &&
                    'bg-teal-500 text-slate-950 shadow-[0_0_0_3px_rgba(45,212,191,0.25)]',
                  voiceState === 'speaking' &&
                    'bg-teal-500 text-slate-950',
                  voiceState === 'waiting' &&
                    'bg-teal-500/80 text-slate-950',
                  voiceState === 'idle' &&
                    'bg-teal-500 text-slate-950 hover:bg-teal-400 active:bg-teal-600 active:scale-[0.97]'
                )}
                title={
                  !voiceSupported
                    ? 'Voice mode not supported in this browser'
                    : voiceState === 'speaking'
                      ? 'Tap to interrupt'
                      : voiceMode
                        ? 'Stop voice mode'
                        : 'Start voice mode'
                }
                aria-label={
                  !voiceSupported
                    ? 'Voice mode not supported'
                    : voiceMode
                      ? 'Stop voice mode'
                      : 'Start voice mode'
                }
              >
                {voiceState === 'speaking' ? (
                  <Volume2 size={16} className="relative z-10" strokeWidth={2.5} />
                ) : (
                  <Mic size={16} className="relative z-10" strokeWidth={2.5} />
                )}
                {voiceState === 'listening' && (
                  <span className="absolute inset-0 rounded-2xl bg-teal-300/40 animate-ping pointer-events-none" />
                )}
              </button>
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={busy || sessionLimitReached || !input.trim() || voiceDraft}
                className="w-11 h-11 flex items-center justify-center rounded-2xl bg-teal-500 text-slate-950 hover:bg-teal-400 active:bg-teal-600 active:scale-[0.97] transition-all disabled:opacity-35 disabled:hover:bg-teal-500 disabled:active:scale-100 shrink-0"
                aria-label="Send message"
              >
                <Send size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AiCoachPanel;

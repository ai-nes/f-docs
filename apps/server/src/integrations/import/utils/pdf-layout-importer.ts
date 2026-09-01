import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { load } from 'cheerio';

const execFileAsync = promisify(execFile);

type PdfFontSpec = {
  family: string;
  size: number;
  color: string;
};

type PdfTextItem = {
  top: number;
  left: number;
  width: number;
  height: number;
  text: string;
  font: PdfFontSpec;
  bold: boolean;
  italic: boolean;
  inlineHtml: string;
};

type PdfLine = {
  top: number;
  items: PdfTextItem[];
};

type PdfImage = {
  top: number;
  left: number;
  width: number;
  height: number;
  index: number;
};

type TableRange = {
  start: number;
  end: number;
  columnStarts: number[];
  pageWidth: number;
};

type PdfEvent =
  | { type: 'line'; top: number; line: PdfLine }
  | { type: 'image'; top: number; image: PdfImage }
  | { type: 'table'; top: number; html: string };

type RenderedPage = {
  html: string;
  lines: PdfLine[];
  tableRanges: TableRange[];
  pageWidth: number;
  pageHeight: number;
};

const DEFAULT_FONT: PdfFontSpec = {
  family: 'Arial',
  size: 12,
  color: '#222222',
};

const CONTENT_LEFT = 84;
const TABLE_X_TOLERANCE = 22;
const MIN_TABLE_COLUMN_GAP = 60;
const MAX_LINE_GROUP_DISTANCE = 3;
const CENTER_ALIGNMENT_TOLERANCE = 28;

function numberAttr(value: string | undefined, fallback = 0): number {
  const parsed = Number.parseFloat(value || '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function cleanFontFamily(family: string): string {
  return family.replace(/^[A-Z]+\+/, '').replaceAll('"', '');
}

function normalizeColor(color: string | undefined): string {
  return color?.trim() || '#222222';
}

function isNear(value: number, target: number): boolean {
  return Math.abs(value - target) <= TABLE_X_TOLERANCE;
}

function renderXmlInline($: ReturnType<typeof load>, node: any): string {
  if (node.type === 'text') {
    return escapeHtml(node.data || '');
  }

  if (node.type !== 'tag') {
    return '';
  }

  const content = $(node)
    .contents()
    .toArray()
    .map((child) => renderXmlInline($, child))
    .join('');
  const tag = String(node.name || '').toLowerCase();

  if (tag === 'b' || tag === 'strong') {
    return `<strong>${content}</strong>`;
  }

  if (tag === 'i' || tag === 'em') {
    return `<em>${content}</em>`;
  }

  return content;
}

function renderInlineItems(items: PdfTextItem[]): string {
  return items
    .map((item) => {
      const family = cleanFontFamily(item.font.family);
      const style = [
        `color:${normalizeColor(item.font.color)}`,
        family ? `font-family:${escapeHtml(family)}` : '',
        `font-size:${item.font.size}pt`,
      ]
        .filter(Boolean)
        .join(';');

      return `<span style="${style}">${item.inlineHtml}</span>`;
    })
    .join(' ')
    .replaceAll(' </span>', '</span>');
}

function plainLineText(line: PdfLine): string {
  return line.items
    .map((item) => item.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lineFontSize(line: PdfLine): number {
  return Math.max(...line.items.map((item) => item.font.size), 0);
}

function lineColor(line: PdfLine): string {
  return normalizeColor(line.items[0]?.font.color).toLowerCase();
}

function isBulletStart(line: PdfLine): boolean {
  return /^([•·▪◦]|[-–—])$/.test(line.items[0]?.text.trim() || '');
}

function isHeading(line: PdfLine): 'h1' | 'h2' | 'h3' | null {
  const size = lineFontSize(line);
  const bold = line.items.some((item) => item.bold);
  const color = lineColor(line);

  if (size >= 30) return 'h1';
  if (size >= 22 && bold) return 'h2';
  if (size >= 18 && (bold || color === '#c0521f')) return 'h3';
  return null;
}

function isBlockquote(line: PdfLine, pageWidth: number): boolean {
  const left = Math.min(...line.items.map((item) => item.left));
  const size = lineFontSize(line);
  return (
    left >= CONTENT_LEFT + 10 &&
    left < pageWidth - 40 &&
    size >= 15 &&
    size <= 17 &&
    line.items.every((item) => item.italic)
  );
}

function groupTextLines(items: PdfTextItem[]): PdfLine[] {
  const lines: PdfLine[] = [];

  for (const item of items.sort((a, b) => a.top - b.top || a.left - b.left)) {
    let line = lines.find(
      (candidate) =>
        Math.abs(candidate.top - item.top) <= MAX_LINE_GROUP_DISTANCE,
    );

    if (!line) {
      line = { top: item.top, items: [] };
      lines.push(line);
    }

    line.items.push(item);
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.left - b.left);
  }

  return lines.sort((a, b) => a.top - b.top);
}

function commonColumnStarts(a: number[], b: number[]): number[] {
  return a.filter((left) => b.some((other) => isNear(left, other)));
}

function distinctColumnStarts(line: PdfLine): number[] {
  return line.items.reduce<number[]>((starts, item) => {
    if (!starts.some((start) => isNear(start, item.left))) {
      starts.push(item.left);
    }
    return starts;
  }, []);
}

function detectTableRanges(lines: PdfLine[], pageWidth: number): TableRange[] {
  const ranges: TableRange[] = [];
  let cursor = 0;

  while (cursor < lines.length) {
    const first = lines[cursor];
    const baseStarts = distinctColumnStarts(first);
    if (
      baseStarts.length < 2 ||
      baseStarts[1] - baseStarts[0] < MIN_TABLE_COLUMN_GAP
    ) {
      cursor += 1;
      continue;
    }

    const candidateIndexes = [cursor];
    let columnStarts = baseStarts;
    const expectedColumnCount = Math.min(3, baseStarts.length);
    let previousTop = first.top;

    for (let index = cursor + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.top - previousTop > 52) break;

      const starts = distinctColumnStarts(line);
      if (starts.length < 2) continue;
      const common = commonColumnStarts(columnStarts, starts);
      if (common.length < expectedColumnCount) continue;

      candidateIndexes.push(index);
      columnStarts = common;
      previousTop = line.top;
    }

    // A two-column table can consist of only a header row and one data row.
    // Requiring three candidate lines would flatten that valid table back into
    // ordinary paragraphs.
    if (candidateIndexes.length >= 2 && columnStarts.length >= 2) {
      let end = candidateIndexes[candidateIndexes.length - 1];

      // A cell can wrap onto a line with only one visible column (for example
      // the final "sao" in the sample PDF). Keep those continuation lines in
      // the table instead of turning them into a paragraph below it.
      for (let index = end + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.top - lines[end].top > 35) break;
        const belongsToTable = line.items.some((item) =>
          columnStarts.some((start) => isNear(item.left, start)),
        );
        if (!belongsToTable) break;
        end = index;
      }

      ranges.push({
        start: cursor,
        end,
        columnStarts,
        pageWidth,
      });
      cursor = end + 1;
      continue;
    }

    cursor += 1;
  }

  return ranges;
}

function tableRowBreakThreshold(lines: PdfLine[]): number {
  const gaps = lines
    .slice(1)
    .map((line, index) => line.top - lines[index].top)
    .filter((gap) => gap > MAX_LINE_GROUP_DISTANCE);

  if (gaps.length === 0) return Number.POSITIVE_INFINITY;
  if (gaps.length === 1) return gaps[0] * 0.8;

  const sorted = [...gaps].sort((a, b) => a - b);
  let largestJump = 0;
  let splitIndex = 0;

  for (let index = 1; index < sorted.length; index += 1) {
    const jump = sorted[index] - sorted[index - 1];
    if (jump > largestJump) {
      largestJump = jump;
      splitIndex = index;
    }
  }

  // Wrapped lines normally have a short baseline gap while the next logical
  // row has extra cell padding. Split between those two clusters when the
  // PDF exposes that distinction; otherwise each visual line is safest as a
  // separate row for tables whose rows do not wrap.
  if (largestJump >= Math.max(6, sorted[0] * 0.25)) {
    return (sorted[splitIndex - 1] + sorted[splitIndex]) / 2;
  }

  return sorted[0] * 0.8;
}

function renderTable(lines: PdfLine[], range: TableRange): string {
  const rows: PdfTextItem[][][] = [];
  let current: PdfTextItem[][] = [];
  const rowBreakThreshold = tableRowBreakThreshold(
    lines.slice(range.start, range.end + 1),
  );

  const flushRow = () => {
    if (current.some((cell) => cell.length > 0)) {
      rows.push(current);
    }
    current = [];
  };

  for (let index = range.start; index <= range.end; index += 1) {
    const line = lines[index];
    const previousLine = lines[index - 1];
    const startsNewRow =
      index > range.start && line.top - previousLine.top >= rowBreakThreshold;

    if (startsNewRow && current.length > 0) {
      flushRow();
    }

    if (current.length === 0) {
      current = range.columnStarts.map(() => []);
    }

    for (const item of line.items) {
      let column = 0;
      let distance = Number.POSITIVE_INFINITY;

      range.columnStarts.forEach((start, candidate) => {
        const candidateDistance = Math.abs(item.left - start);
        if (candidateDistance < distance) {
          column = candidate;
          distance = candidateDistance;
        }
      });

      if (distance <= TABLE_X_TOLERANCE * 2) {
        current[column].push(item);
      }
    }
  }

  flushRow();

  if (rows.length < 2) return '';

  const header = rows[0];
  const body = rows.slice(1);
  const columnWidths = range.columnStarts.map((start, index) => {
    const nextStart =
      range.columnStarts[index + 1] || range.pageWidth - CONTENT_LEFT;
    return Math.max(80, Math.round(nextStart - start));
  });
  const renderCell = (items: PdfTextItem[], headerCell: boolean) => {
    const tag = headerCell ? 'th' : 'td';
    const style = headerCell ? 'background-color:#13294b;color:#ffffff' : '';
    const content = renderInlineItems(items) || '&nbsp;';
    return `<${tag}${style ? ` style="${style}"` : ''}><p>${content}</p></${tag}>`;
  };

  const renderRow = (row: PdfTextItem[][], headerRow: boolean) =>
    `<tr>${row
      .map((cell, index) => {
        const cellHtml = renderCell(cell, headerRow);
        return cellHtml.replace(
          `<${headerRow ? 'th' : 'td'}`,
          `<${headerRow ? 'th' : 'td'} width="${columnWidths[index]}"`,
        );
      })
      .join('')}</tr>`;

  return `<table data-pdf-table="true" style="width:100%"><thead>${renderRow(header, true)}</thead><tbody>${body
    .map((row) => renderRow(row, false))
    .join('')}</tbody></table>`;
}

function renderTextLine(line: PdfLine, omitBullet = false): string {
  const items = omitBullet ? line.items.slice(1) : line.items;
  return renderInlineItems(items);
}

function lineAlignment(
  line: PdfLine,
  pageWidth: number,
): 'left' | 'center' | 'right' {
  if (line.items.length === 0) return 'left';

  const left = Math.min(...line.items.map((item) => item.left));
  const right = Math.max(
    ...line.items.map((item) => item.left + Math.max(item.width, 1)),
  );
  const center = (left + right) / 2;

  if (Math.abs(center - pageWidth / 2) <= CENTER_ALIGNMENT_TOLERANCE) {
    return 'center';
  }

  if (pageWidth - right <= CONTENT_LEFT) return 'right';
  return 'left';
}

function renderAlignedTextBlock(
  tag: 'p' | 'h1' | 'h2' | 'h3',
  lines: PdfLine[],
  pageWidth: number,
  sourceLineAttributes = '',
): string {
  const alignment = lineAlignment(lines[0], pageWidth);
  const style = alignment === 'left' ? '' : ` style="text-align:${alignment}"`;
  return `<${tag}${style}${sourceLineAttributes}>${lines
    .map((line) => renderTextLine(line))
    .join(' ')}</${tag}>`;
}

function renderPage(
  page: any,
  $: ReturnType<typeof load>,
  fonts: Map<string, PdfFontSpec>,
  imageUrls: Map<number, string>,
  nextImageIndex: { value: number },
  runningHeaderTexts: Set<string>,
): RenderedPage {
  const pageWidth = numberAttr($(page).attr('width'), 892);
  const pageHeight = numberAttr($(page).attr('height'), 1262);
  const textItems: PdfTextItem[] = [];

  $(page)
    .children('text')
    .each((_, element) => {
      const text = $(element).text().replace(/\s+/g, ' ').trim();
      if (!text) return;

      const top = numberAttr($(element).attr('top'));
      const left = numberAttr($(element).attr('left'));

      // Running page headers are identified across the whole PDF below. Do
      // not drop every top-right line: a table cell can legitimately continue
      // there on the next page.
      if (top < 70 && left > pageWidth / 2 && runningHeaderTexts.has(text)) {
        return;
      }
      if (top > pageHeight - 90 && /^Trang\s+/i.test(text)) return;

      const fontId = $(element).attr('font') || '';
      const font = fonts.get(fontId) || DEFAULT_FONT;
      textItems.push({
        top,
        left,
        width: numberAttr($(element).attr('width')),
        height: numberAttr($(element).attr('height')),
        text,
        font,
        bold: $(element).find('b, strong').length > 0,
        italic: $(element).find('i, em').length > 0,
        inlineHtml: renderXmlInline($, element),
      });
    });

  const lines = groupTextLines(textItems);
  const tableRanges = detectTableRanges(lines, pageWidth);
  const consumedLines = new Set<number>();
  const events: PdfEvent[] = [];

  for (const range of tableRanges) {
    const html = renderTable(lines, range);
    if (html) {
      for (let index = range.start; index <= range.end; index += 1) {
        consumedLines.add(index);
      }
      events.push({ type: 'table', top: lines[range.start].top, html });
    }
  }

  $(page)
    .children('image')
    .each((_, element) => {
      const image: PdfImage = {
        top: numberAttr($(element).attr('top')),
        left: numberAttr($(element).attr('left')),
        width: numberAttr($(element).attr('width')),
        height: numberAttr($(element).attr('height')),
        index: nextImageIndex.value,
      };
      nextImageIndex.value += 1;
      events.push({ type: 'image', top: image.top, image });
    });

  lines.forEach((line, index) => {
    if (!consumedLines.has(index)) {
      events.push({ type: 'line', top: line.top, line });
    }
  });

  events.sort((a, b) => a.top - b.top);

  const output: string[] = [];
  let paragraphLines: PdfLine[] = [];
  let bulletItems: string[] = [];
  let blockquoteLines: PdfLine[] = [];
  let lastBlockquoteTop = -Infinity;
  let lastLineTop = -Infinity;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const firstLine = paragraphLines[0];
    const sourceLineAttributes = ` data-pdf-line-left="${Math.round(
      Math.min(...firstLine.items.map((item) => item.left)),
    )}" data-pdf-line-top="${Math.round(firstLine.top)}"`;
    output.push(
      renderAlignedTextBlock(
        'p',
        paragraphLines,
        pageWidth,
        sourceLineAttributes,
      ),
    );
    paragraphLines = [];
  };

  const flushBullets = () => {
    if (bulletItems.length === 0) return;
    output.push(
      `<ul>${bulletItems.map((item) => `<li>${item}</li>`).join('')}</ul>`,
    );
    bulletItems = [];
  };

  const flushBlockquote = () => {
    if (blockquoteLines.length === 0) return;
    output.push(
      `<div data-type="callout" data-callout-type="warning"><p>${blockquoteLines
        .map((line) => renderTextLine(line))
        .join(' ')}</p></div>`,
    );
    blockquoteLines = [];
    lastBlockquoteTop = -Infinity;
  };

  const flushText = () => {
    flushParagraph();
    flushBullets();
    flushBlockquote();
    lastLineTop = -Infinity;
  };

  for (const event of events) {
    if (event.type === 'image') {
      flushText();
      const url = imageUrls.get(event.image.index);
      if (!url) continue;

      const contentWidth = Math.max(pageWidth - CONTENT_LEFT * 2, 1);
      const widthPercent = Math.min(
        100,
        Math.max(20, Math.round((event.image.width / contentWidth) * 100)),
      );
      const attachmentId = url.match(/\/files\/([^/]+)/)?.[1];
      output.push(
        `<img src="${escapeHtml(url)}" width="${widthPercent}%" data-align="center"${
          attachmentId
            ? ` data-attachment-id="${escapeHtml(attachmentId)}"`
            : ''
        } alt="PDF image" />`,
      );
      continue;
    }

    if (event.type === 'table') {
      flushText();
      output.push(event.html);
      continue;
    }

    const line = event.line;
    const heading = isHeading(line);
    const text = plainLineText(line);
    if (!text) continue;

    if (heading) {
      flushText();
      output.push(renderAlignedTextBlock(heading, [line], pageWidth));
      lastLineTop = line.top;
      continue;
    }

    if (isBlockquote(line, pageWidth)) {
      flushParagraph();
      flushBullets();
      if (blockquoteLines.length > 0 && line.top - lastBlockquoteTop <= 35) {
        blockquoteLines.push(line);
      } else {
        flushBlockquote();
        blockquoteLines = [line];
      }
      lastBlockquoteTop = line.top;
      lastLineTop = line.top;
      continue;
    }

    if (blockquoteLines.length > 0) flushBlockquote();

    if (isBulletStart(line)) {
      flushParagraph();
      if (lastLineTop !== -Infinity && line.top - lastLineTop > 40) {
        flushBullets();
      }
      bulletItems.push(renderTextLine(line, true));
      lastLineTop = line.top;
      continue;
    }

    const isLikelyBulletContinuation =
      bulletItems.length > 0 &&
      line.top - lastLineTop <= 35 &&
      Math.min(...line.items.map((item) => item.left)) > CONTENT_LEFT + 15;

    if (isLikelyBulletContinuation) {
      bulletItems[bulletItems.length - 1] += ` ${renderTextLine(line)}`;
      lastLineTop = line.top;
      continue;
    }

    if (bulletItems.length > 0) flushBullets();

    if (
      paragraphLines.length > 0 &&
      line.top - lastLineTop <= 34 &&
      Math.min(...line.items.map((item) => item.left)) <= CONTENT_LEFT + 12
    ) {
      paragraphLines.push(line);
    } else {
      flushParagraph();
      paragraphLines = [line];
    }
    lastLineTop = line.top;
  }

  flushText();

  return {
    html: output.join('\n'),
    lines,
    tableRanges,
    pageWidth,
    pageHeight,
  };
}

function getTableHeaderText(table: any): string {
  return table.find('> thead > tr').first().text().replace(/\s+/g, ' ').trim();
}

function isTableAtPageEnd(page: RenderedPage, range: TableRange): boolean {
  return (
    range.end === page.lines.length - 1 &&
    page.lines[range.end]?.top >= page.pageHeight * 0.65
  );
}

function tableRangesMatch(a: TableRange, b: TableRange): boolean {
  const expected = Math.min(a.columnStarts.length, b.columnStarts.length);
  return (
    expected >= 2 &&
    commonColumnStarts(a.columnStarts, b.columnStarts).length >= expected
  );
}

/**
 * PDF layout extraction is page-scoped. A table that reaches the bottom of a
 * page can therefore become two unrelated HTML tables (or a loose paragraph
 * when the next page contains only the tail of a cell). Stitch only the
 * unambiguous continuation cases here, before the page-break nodes are added.
 */
function mergeCrossPageTables(pages: RenderedPage[]): void {
  for (let index = 0; index < pages.length - 1; index += 1) {
    const current = pages[index];
    const next = pages[index + 1];
    const currentRange = current.tableRanges[current.tableRanges.length - 1];

    if (!currentRange || !isTableAtPageEnd(current, currentRange)) continue;

    const $current = load(current.html);
    const $next = load(next.html);
    const currentTable = $current('table[data-pdf-table="true"]').last();
    if (!currentTable.length) continue;

    const nextRange = next.tableRanges[0];
    const nextTable = $next('table[data-pdf-table="true"]').first();

    if (
      nextRange &&
      nextRange.start <= 1 &&
      nextTable.length &&
      tableRangesMatch(currentRange, nextRange)
    ) {
      const currentHeader = getTableHeaderText(currentTable);
      const nextHeader = getTableHeaderText(nextTable);
      const nextFirstLine = next.lines[nextRange.start];
      const nextHeaderLooksBold =
        nextFirstLine?.items.length > 0 &&
        nextFirstLine.items.every((item) => item.bold);
      const hasRepeatedHeader = currentHeader === nextHeader;

      // A repeated header is strong evidence that the second table is a
      // continuation. When a PDF does not repeat headers, a non-bold first
      // row is the usual signal that the second segment starts with body
      // data. Treat that row as body data rather than manufacturing a second
      // header.
      if (hasRepeatedHeader || !nextHeaderLooksBold) {
        const currentBody = currentTable.find('> tbody').first();
        if (!hasRepeatedHeader) {
          const nextHeaderRow = nextTable.find('> thead > tr').first();
          if (nextHeaderRow.length) currentBody.append(nextHeaderRow);
        }
        nextTable.find('> tbody > tr').each((_, row) => {
          currentBody.append(row);
        });
        nextTable.remove();
        current.html = $current('body').html() || '';
        next.html = $next('body').html() || '';
        continue;
      }
    }

    // Some PDF producers do not repeat the table header. If only a tail line
    // of the last cell survives on the next page, append that line to the
    // matching cell instead of leaving it as a centred paragraph below the
    // PAGE BREAK marker. Restrict this to the first block and a non-first
    // column to avoid absorbing an ordinary page heading.
    if (nextTable.length) continue;
    const firstElement = $next('body').children().first();
    if (firstElement.length !== 1 || firstElement[0].name !== 'p') continue;

    const sourceLeft = Number.parseFloat(
      firstElement.attr('data-pdf-line-left') || '',
    );
    const sourceTop = Number.parseFloat(
      firstElement.attr('data-pdf-line-top') || '',
    );
    if (
      !Number.isFinite(sourceLeft) ||
      !Number.isFinite(sourceTop) ||
      sourceTop > 140
    ) {
      continue;
    }

    let column = 0;
    let distance = Number.POSITIVE_INFINITY;
    currentRange.columnStarts.forEach((start, candidate) => {
      const candidateDistance = Math.abs(sourceLeft - start);
      if (candidateDistance < distance) {
        column = candidate;
        distance = candidateDistance;
      }
    });
    if (column === 0 || distance > TABLE_X_TOLERANCE * 2) continue;

    const lastRow = currentTable.find('> tbody > tr').last();
    const lastCell = lastRow.children('td, th').eq(column);
    const lastParagraph = lastCell.find('p').last();
    if (!lastCell.length) continue;

    if (lastParagraph.length) {
      lastParagraph.append(` ${firstElement.html() || ''}`);
    } else {
      lastCell.append(`<p>${firstElement.html() || '&nbsp;'}</p>`);
    }
    firstElement.remove();
    current.html = $current('body').html() || '';
    next.html = $next('body').html() || '';
  }
}

function renderPdfXml(xml: string, imageUrls: Map<number, string>): string {
  const $ = load(xml, { xmlMode: true });
  const fonts = new Map<string, PdfFontSpec>();

  $('fontspec').each((_, element) => {
    fonts.set($(element).attr('id') || '', {
      family: $(element).attr('family') || DEFAULT_FONT.family,
      size: numberAttr($(element).attr('size'), DEFAULT_FONT.size),
      color: normalizeColor($(element).attr('color')),
    });
  });

  const nextImageIndex = { value: 0 };
  const runningHeaderCounts = new Map<string, number>();
  $('page').each((_, page) => {
    const pageWidth = numberAttr($(page).attr('width'), 892);
    $(page)
      .children('text')
      .each((_, element) => {
        const text = $(element).text().replace(/\s+/g, ' ').trim();
        const top = numberAttr($(element).attr('top'));
        const left = numberAttr($(element).attr('left'));
        if (text && top < 70 && left > pageWidth / 2) {
          runningHeaderCounts.set(
            text,
            (runningHeaderCounts.get(text) || 0) + 1,
          );
        }
      });
  });
  const runningHeaderTexts = new Set(
    [...runningHeaderCounts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([text]) => text),
  );
  const renderedPages = $('page')
    .toArray()
    .map((page) =>
      renderPage(page, $, fonts, imageUrls, nextImageIndex, runningHeaderTexts),
    )
    .filter((page) => page.html.trim());

  mergeCrossPageTables(renderedPages);

  const pages = renderedPages
    .map((page) =>
      page.html
        .replace(/\sdata-pdf-line-(?:left|top)="[^"]*"/g, '')
        .replace(/\sdata-pdf-table="true"/g, ''),
    )
    .filter((page) => page.trim());

  return pages.join('<div data-type="pageBreak"></div>');
}

/**
 * Converts a PDF into editor-oriented HTML while retaining the source PDF's
 * reading order, headings, colors, tables, images, and page boundaries.
 *
 * Markdown extraction is intentionally not used here: it loses coordinates in
 * multi-column layouts and consequently scrambles tables and captions.
 */
export async function convertPdfBufferToEditorHtml(
  fileBuffer: Buffer,
  imageUrls: Map<number, string>,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'f-doc-pdf-'));
  const pdfPath = join(directory, 'input.pdf');

  try {
    await writeFile(pdfPath, fileBuffer);
    const { stdout } = await execFileAsync(
      'pdftohtml',
      ['-xml', '-stdout', '-hidden', '-enc', 'UTF-8', pdfPath, '-'],
      {
        cwd: directory,
        maxBuffer: 64 * 1024 * 1024,
      },
    );

    const html = renderPdfXml(stdout, imageUrls);
    if (!html.trim()) {
      throw new Error('The PDF did not contain readable text or layout data.');
    }

    return html;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

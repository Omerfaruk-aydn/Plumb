/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useMemo } from 'react';
import { Box, Text, useIsScreenReaderEnabled } from 'ink';
import { colorizeCode, colorizeLine } from '../../utils/CodeColorizer.js';
import { MaxSizedBox } from '../shared/MaxSizedBox.js';
import { theme as semanticTheme } from '../../semantic-colors.js';
import type { Theme } from '../../themes/theme.js';
import { useSettings } from '../../contexts/SettingsContext.js';
import { getFileExtension } from '../../utils/fileUtils.js';
import { truncateToWidth } from '../../utils/textUtils.js';

// Re-exported because this module was where it lived before the pill strip
// needed it too; importing all of DiffRenderer to get one string helper is a
// dependency the pills have no business carrying.
export { truncateToWidth };

export interface DiffLine {
  type: 'add' | 'del' | 'context' | 'hunk' | 'other';
  oldLine?: number;
  newLine?: number;
  content: string;
}

export function parseDiffWithLineNumbers(diffContent: string): DiffLine[] {
  const lines = diffContent.split(/\r?\n/);
  const result: DiffLine[] = [];
  let currentOldLine = 0;
  let currentNewLine = 0;
  let inHunk = false;
  const hunkHeaderRegex = /^@@ -(\d+),?\d* \+(\d+),?\d* @@/;

  for (const line of lines) {
    const hunkMatch = line.match(hunkHeaderRegex);
    if (hunkMatch) {
      currentOldLine = parseInt(hunkMatch[1], 10);
      currentOldLine = parseInt(hunkMatch[1], 10);
      currentNewLine = parseInt(hunkMatch[2], 10);
      inHunk = true;
      result.push({ type: 'hunk', content: line });
      // We need to adjust the starting point because the first line number applies to the *first* actual line change/context,
      // but we increment *before* pushing that line. So decrement here.
      currentOldLine--;
      currentNewLine--;
      continue;
    }
    if (!inHunk) {
      // Skip standard Git header lines more robustly
      if (line.startsWith('--- ')) {
        continue;
      }
      // If it's not a hunk or header, skip (or handle as 'other' if needed)
      continue;
    }
    if (line.startsWith('+')) {
      currentNewLine++; // Increment before pushing
      result.push({
        type: 'add',
        newLine: currentNewLine,
        content: line.substring(1),
      });
    } else if (line.startsWith('-')) {
      currentOldLine++; // Increment before pushing
      result.push({
        type: 'del',
        oldLine: currentOldLine,
        content: line.substring(1),
      });
    } else if (line.startsWith(' ')) {
      currentOldLine++; // Increment before pushing
      currentNewLine++;
      result.push({
        type: 'context',
        oldLine: currentOldLine,
        newLine: currentNewLine,
        content: line.substring(1),
      });
    } else if (line.startsWith('\\')) {
      // Handle "\ No newline at end of file"
      result.push({ type: 'other', content: line });
    }
  }
  return result;
}

interface DiffRendererProps {
  diffContent: string;
  filename?: string;
  tabWidth?: number;
  availableTerminalHeight?: number;
  terminalWidth: number;
  theme?: Theme;
  disableColor?: boolean;
  paddingX?: number;
}

const DEFAULT_TAB_WIDTH = 4; // Spaces per tab for normalization

/** F20 (PLUMB-UI-DEVRIM-PROMPT.md): 'auto' picks split at this width or wider. */
export const SPLIT_VIEW_MIN_WIDTH = 120;

export function resolveDiffLayout(
  diffStyle: 'auto' | 'stacked' | 'split' | undefined,
  terminalWidth: number,
  screenReaderEnabled: boolean,
): 'stacked' | 'split' {
  // A screen reader always gets the linear, one-line-at-a-time layout --
  // two side-by-side columns have no sensible reading order.
  if (screenReaderEnabled) return 'stacked';
  if (diffStyle === 'split') return 'split';
  if (diffStyle === 'stacked') return 'stacked';
  return terminalWidth >= SPLIT_VIEW_MIN_WIDTH ? 'split' : 'stacked';
}

export const DiffRenderer: React.FC<DiffRendererProps> = ({
  diffContent,
  filename,
  tabWidth = DEFAULT_TAB_WIDTH,
  availableTerminalHeight,
  terminalWidth,
  theme,
  disableColor = false,
  paddingX = 0,
}) => {
  const settings = useSettings();

  const screenReaderEnabled = useIsScreenReaderEnabled();

  const parsedLines = useMemo(() => {
    if (!diffContent || typeof diffContent !== 'string') {
      return [];
    }
    return parseDiffWithLineNumbers(diffContent);
  }, [diffContent]);

  const isNewFileResult = useMemo(() => isNewFile(parsedLines), [parsedLines]);

  const diffStyleSetting = settings.merged.ui?.diffStyle;
  const layout = resolveDiffLayout(
    diffStyleSetting,
    terminalWidth,
    screenReaderEnabled,
  );

  const renderedOutput = useMemo(() => {
    if (!diffContent || typeof diffContent !== 'string') {
      return <Text color={semanticTheme.status.warning}>No diff content.</Text>;
    }

    if (parsedLines.length === 0) {
      return (
        <Box padding={1}>
          <Text dimColor>No changes detected.</Text>
        </Box>
      );
    }
    if (screenReaderEnabled) {
      return (
        <Box flexDirection="column">
          {parsedLines.map((line, index) => (
            <Text key={index}>
              {line.type}: {line.content}
            </Text>
          ))}
        </Box>
      );
    }

    if (isNewFileResult) {
      // Extract only the added lines' content
      const addedContent = parsedLines
        .filter((line) => line.type === 'add')
        .map((line) => line.content)
        .join('\n');
      // Attempt to infer language from filename, default to plain text if no filename
      const fileExtension = getFileExtension(filename);
      const language = fileExtension
        ? getLanguageFromExtension(fileExtension)
        : null;
      return colorizeCode({
        code: addedContent,
        language,
        availableHeight: availableTerminalHeight,
        maxWidth: terminalWidth,
        theme,
        settings,
        disableColor,
        paddingX,
      });
    } else {
      const key = filename ? `diff-box-${filename}` : undefined;

      return (
        <MaxSizedBox
          paddingX={paddingX}
          maxHeight={availableTerminalHeight}
          maxWidth={terminalWidth}
          key={key}
        >
          {layout === 'split'
            ? renderSplitDiffLines({
                parsedLines,
                filename,
                tabWidth,
                terminalWidth,
                disableColor,
              })
            : renderDiffLines({
                parsedLines,
                filename,
                tabWidth,
                terminalWidth,
                disableColor,
              })}
        </MaxSizedBox>
      );
    }
  }, [
    diffContent,
    parsedLines,
    screenReaderEnabled,
    isNewFileResult,
    layout,
    filename,
    availableTerminalHeight,
    terminalWidth,
    theme,
    settings,
    tabWidth,
    disableColor,
    paddingX,
  ]);

  return renderedOutput;
};

export const isNewFile = (parsedLines: DiffLine[]): boolean => {
  if (parsedLines.length === 0) return false;
  return parsedLines.every(
    (line) =>
      line.type === 'add' ||
      line.type === 'hunk' ||
      line.type === 'other' ||
      line.content.startsWith('diff --git') ||
      line.content.startsWith('new file mode'),
  );
};

export interface RenderDiffLinesOptions {
  parsedLines: DiffLine[];
  filename?: string;
  tabWidth?: number;
  terminalWidth: number;
  disableColor?: boolean;
}

export const renderDiffLines = ({
  parsedLines,
  filename,
  tabWidth = DEFAULT_TAB_WIDTH,
  terminalWidth,
  disableColor = false,
}: RenderDiffLinesOptions): React.ReactNode[] => {
  // 1. Normalize whitespace (replace tabs with spaces) *before* further processing
  const normalizedLines = parsedLines.map((line) => ({
    ...line,
    content: line.content.replace(/\t/g, ' '.repeat(tabWidth)),
  }));

  // Filter out non-displayable lines (hunks, potentially 'other') using the normalized list
  const displayableLines = normalizedLines.filter(
    (l) => l.type !== 'hunk' && l.type !== 'other',
  );

  if (displayableLines.length === 0) {
    return [
      <Box key="no-changes" padding={1}>
        <Text dimColor>No changes detected.</Text>
      </Box>,
    ];
  }

  const maxLineNumber = Math.max(
    0,
    ...displayableLines.map((l) => l.oldLine ?? 0),
    ...displayableLines.map((l) => l.newLine ?? 0),
  );
  const gutterWidth = Math.max(1, maxLineNumber.toString().length);

  const fileExtension = getFileExtension(filename);
  const language = fileExtension
    ? getLanguageFromExtension(fileExtension)
    : null;

  // Calculate the minimum indentation across all displayable lines
  let baseIndentation = Infinity; // Start high to find the minimum
  for (const line of displayableLines) {
    // Only consider lines with actual content for indentation calculation
    if (line.content.trim() === '') continue;

    const firstCharIndex = line.content.search(/\S/); // Find index of first non-whitespace char
    const currentIndent = firstCharIndex === -1 ? 0 : firstCharIndex; // Indent is 0 if no non-whitespace found
    baseIndentation = Math.min(baseIndentation, currentIndent);
  }
  // If baseIndentation remained Infinity (e.g., no displayable lines with content), default to 0
  if (!isFinite(baseIndentation)) {
    baseIndentation = 0;
  }

  let lastLineNumber: number | null = null;
  const MAX_CONTEXT_LINES_WITHOUT_GAP = 5;

  const content = displayableLines.reduce<React.ReactNode[]>(
    (acc, line, index) => {
      // Determine the relevant line number for gap calculation based on type
      let relevantLineNumberForGapCalc: number | null = null;
      if (line.type === 'add' || line.type === 'context') {
        relevantLineNumberForGapCalc = line.newLine ?? null;
      } else if (line.type === 'del') {
        // For deletions, the gap is typically in relation to the original file's line numbering
        relevantLineNumberForGapCalc = line.oldLine ?? null;
      }

      if (
        lastLineNumber !== null &&
        relevantLineNumberForGapCalc !== null &&
        relevantLineNumberForGapCalc >
          lastLineNumber + MAX_CONTEXT_LINES_WITHOUT_GAP + 1
      ) {
        acc.push(
          <Box key={`gap-${index}`}>
            <Box
              borderStyle="double"
              borderLeft={false}
              borderRight={false}
              borderBottom={false}
              width={terminalWidth}
              borderColor={semanticTheme.text.secondary}
            ></Box>
          </Box>,
        );
      }

      const lineKey = `diff-line-${index}`;
      let gutterNumStr = '';
      let prefixSymbol = ' ';

      switch (line.type) {
        case 'add':
          gutterNumStr = (line.newLine ?? '').toString();
          prefixSymbol = '+';
          lastLineNumber = line.newLine ?? null;
          break;
        case 'del':
          gutterNumStr = (line.oldLine ?? '').toString();
          prefixSymbol = '-';
          // For deletions, update lastLineNumber based on oldLine if it's advancing.
          // This helps manage gaps correctly if there are multiple consecutive deletions
          // or if a deletion is followed by a context line far away in the original file.
          if (line.oldLine !== undefined) {
            lastLineNumber = line.oldLine;
          }
          break;
        case 'context':
          gutterNumStr = (line.newLine ?? '').toString();
          prefixSymbol = ' ';
          lastLineNumber = line.newLine ?? null;
          break;
        default:
          return acc;
      }

      const displayContent = line.content.substring(baseIndentation);

      const backgroundColor = disableColor
        ? undefined
        : line.type === 'add'
          ? semanticTheme.background.diff.added
          : line.type === 'del'
            ? semanticTheme.background.diff.removed
            : undefined;

      const gutterColor = disableColor
        ? undefined
        : semanticTheme.text.secondary;

      const symbolColor = disableColor
        ? undefined
        : line.type === 'add'
          ? semanticTheme.status.success
          : line.type === 'del'
            ? semanticTheme.status.error
            : undefined;

      acc.push(
        <Box key={lineKey} flexDirection="row">
          <Box
            width={gutterWidth + 1}
            paddingRight={1}
            flexShrink={0}
            backgroundColor={backgroundColor}
            justifyContent="flex-end"
          >
            <Text color={gutterColor}>{gutterNumStr}</Text>
          </Box>
          {line.type === 'context' ? (
            <>
              <Text>{prefixSymbol} </Text>
              <Text wrap="wrap">
                {colorizeLine(
                  displayContent,
                  language,
                  undefined,
                  disableColor,
                )}
              </Text>
            </>
          ) : (
            <Text backgroundColor={backgroundColor} wrap="wrap">
              <Text color={symbolColor}>{prefixSymbol}</Text>{' '}
              {colorizeLine(displayContent, language, undefined, disableColor)}
            </Text>
          )}
        </Box>,
      );
      return acc;
    },
    [],
  );

  return content;
};

interface SplitSide {
  lineNumber?: number;
  content: string;
  type: 'add' | 'del' | 'context';
}

interface SplitRow {
  left?: SplitSide;
  right?: SplitSide;
}

/**
 * Pairs up a linear del-then-add diff stream into left(old)/right(new) rows.
 * Consecutive deletions are matched against the consecutive additions that
 * follow them, row by row (the same pairing a two-column diff view like
 * GitHub's split mode uses); context lines mirror onto both sides unchanged.
 */
export function buildSplitRows(displayableLines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < displayableLines.length) {
    const line = displayableLines[i];
    if (line.type === 'context') {
      rows.push({
        left: {
          lineNumber: line.oldLine,
          content: line.content,
          type: 'context',
        },
        right: {
          lineNumber: line.newLine,
          content: line.content,
          type: 'context',
        },
      });
      i++;
      continue;
    }

    const dels: DiffLine[] = [];
    while (i < displayableLines.length && displayableLines[i].type === 'del') {
      dels.push(displayableLines[i]);
      i++;
    }
    const adds: DiffLine[] = [];
    while (i < displayableLines.length && displayableLines[i].type === 'add') {
      adds.push(displayableLines[i]);
      i++;
    }

    const pairCount = Math.max(dels.length, adds.length);
    for (let j = 0; j < pairCount; j++) {
      const del = dels[j];
      const add = adds[j];
      rows.push({
        left: del
          ? { lineNumber: del.oldLine, content: del.content, type: 'del' }
          : undefined,
        right: add
          ? { lineNumber: add.newLine, content: add.content, type: 'add' }
          : undefined,
      });
    }

    // Neither a context line nor a del/add run: skip to avoid looping forever
    // on an unexpected line type (already filtered out by the caller, but a
    // defensive guard costs nothing).
    if (dels.length === 0 && adds.length === 0) {
      i++;
    }
  }
  return rows;
}

export interface RenderSplitDiffLinesOptions {
  parsedLines: DiffLine[];
  filename?: string;
  tabWidth?: number;
  terminalWidth: number;
  disableColor?: boolean;
}

export const renderSplitDiffLines = ({
  parsedLines,
  filename,
  tabWidth = DEFAULT_TAB_WIDTH,
  terminalWidth,
  disableColor = false,
}: RenderSplitDiffLinesOptions): React.ReactNode[] => {
  const normalizedLines = parsedLines.map((line) => ({
    ...line,
    content: line.content.replace(/\t/g, ' '.repeat(tabWidth)),
  }));
  const displayableLines = normalizedLines.filter(
    (l) => l.type !== 'hunk' && l.type !== 'other',
  );

  if (displayableLines.length === 0) {
    return [
      <Box key="no-changes" padding={1}>
        <Text dimColor>No changes detected.</Text>
      </Box>,
    ];
  }

  const rows = buildSplitRows(displayableLines);

  const maxOldLine = Math.max(
    0,
    ...displayableLines.map((l) => l.oldLine ?? 0),
  );
  const maxNewLine = Math.max(
    0,
    ...displayableLines.map((l) => l.newLine ?? 0),
  );
  const oldGutterWidth = Math.max(1, maxOldLine.toString().length);
  const newGutterWidth = Math.max(1, maxNewLine.toString().length);

  const fileExtension = getFileExtension(filename);
  const language = fileExtension
    ? getLanguageFromExtension(fileExtension)
    : null;

  // 1 column for the "│" separator between the two halves.
  const columnWidth = Math.max(4, Math.floor((terminalWidth - 1) / 2));

  const renderSide = (
    side: SplitSide | undefined,
    gutterWidth: number,
    columnKey: string,
  ) => {
    const contentWidth = Math.max(1, columnWidth - gutterWidth - 3);
    if (!side) {
      return (
        <Box key={columnKey} width={columnWidth} flexShrink={0}>
          <Text> </Text>
        </Box>
      );
    }

    const backgroundColor = disableColor
      ? undefined
      : side.type === 'add'
        ? semanticTheme.background.diff.added
        : side.type === 'del'
          ? semanticTheme.background.diff.removed
          : undefined;
    const symbolColor = disableColor
      ? undefined
      : side.type === 'add'
        ? semanticTheme.status.success
        : side.type === 'del'
          ? semanticTheme.status.error
          : undefined;
    const prefixSymbol =
      side.type === 'add' ? '+' : side.type === 'del' ? '-' : ' ';
    const truncatedContent = truncateToWidth(side.content, contentWidth);

    return (
      <Box
        key={columnKey}
        width={columnWidth}
        flexShrink={0}
        flexDirection="row"
        backgroundColor={backgroundColor}
      >
        <Box
          width={gutterWidth + 1}
          paddingRight={1}
          flexShrink={0}
          justifyContent="flex-end"
        >
          <Text color={disableColor ? undefined : semanticTheme.text.secondary}>
            {(side.lineNumber ?? '').toString()}
          </Text>
        </Box>
        <Text color={symbolColor}>{prefixSymbol}</Text>
        <Text> </Text>
        <Text wrap="truncate-end">
          {colorizeLine(truncatedContent, language, undefined, disableColor)}
        </Text>
      </Box>
    );
  };

  return rows.map((row, index) => (
    <Box key={`split-row-${index}`} flexDirection="row">
      {renderSide(row.left, oldGutterWidth, `left-${index}`)}
      <Text color={disableColor ? undefined : semanticTheme.text.secondary}>
        │
      </Text>
      {renderSide(row.right, newGutterWidth, `right-${index}`)}
    </Box>
  ));
};

const getLanguageFromExtension = (extension: string): string | null => {
  const languageMap: { [key: string]: string } = {
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    json: 'json',
    css: 'css',
    html: 'html',
    sh: 'bash',
    md: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    txt: 'plaintext',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    rb: 'ruby',
  };
  return languageMap[extension] || null; // Return null if extension not found
};

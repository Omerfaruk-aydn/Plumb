/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { UserIdentity } from './UserIdentity.js';
import { Tips } from './Tips.js';
import { useSettings } from '../contexts/SettingsContext.js';
import { useConfig } from '../contexts/ConfigContext.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { Banner } from './Banner.js';
import { useBanner } from '../hooks/useBanner.js';
import { useTips } from '../hooks/useTips.js';
import { theme } from '../semantic-colors.js';
import { CliSpinner } from './CliSpinner.js';
import {
  PlumbAnimatedWordmark,
  DEFAULT_WORDMARK_FPS,
} from './PlumbAnimatedWordmark.js';
import { getTimeBasedGreeting } from '../utils/greeting.js';

interface AppHeaderProps {
  version: string;
  showDetails?: boolean;
}

/**
 * The terminal width below which we switch to a narrow/column layout to prevent
 * UI elements from wrapping or overlapping.
 */
const NARROW_TERMINAL_BREAKPOINT = 60;

export const AppHeader = ({ version, showDetails = true }: AppHeaderProps) => {
  const settings = useSettings();
  const config = useConfig();
  const {
    terminalWidth,
    bannerData,
    bannerVisible,
    updateInfo,
    isConfigInitialized,
    isAuthenticating,
    history,
  } = useUIState();

  const { bannerText } = useBanner(bannerData);
  const { showTips } = useTips();

  const authType = config.getContentGeneratorConfig()?.authType;
  const loggedOut = isConfigInitialized && !isAuthenticating && !authType;

  const showHeader = !(
    settings.merged.ui.hideBanner || config.getScreenReader()
  );

  const isNarrow = terminalWidth < NARROW_TERMINAL_BREAKPOINT;

  const renderLogo = () => (
    <Box flexDirection="row">
      <Box flexShrink={0}>
        <PlumbAnimatedWordmark
          disabled={settings.merged.ui.animatedLogo === false}
          fps={settings.merged.ui.logoAnimationFps ?? DEFAULT_WORDMARK_FPS}
          terminalWidth={terminalWidth}
          isNarrow={isNarrow}
          noColor={!!process.env['NO_COLOR']}
          screenReader={config.getScreenReader()}
        />
      </Box>
    </Box>
  );

  const renderMetadata = (isBelow = false) => (
    <Box marginLeft={isBelow ? 0 : 2} flexDirection="column">
      {/* Line 1: PLUMB CLI vVersion [Updating] */}
      <Box>
        <Text bold color={theme.text.primary}>
          PLUMB CLI
        </Text>
        <Text color={theme.text.secondary}> v{version}</Text>
        {updateInfo?.isUpdating && (
          <Box marginLeft={2}>
            <Text color={theme.text.secondary}>
              <CliSpinner /> Updating
            </Text>
          </Box>
        )}
      </Box>

      {showDetails && (
        <>
          {/* Line 2: Blank */}
          <Box height={1} />

          {/* Lines 3 & 4: User Identity info (Email /auth and Plan /upgrade) */}
          {settings.merged.ui.showUserIdentity !== false && (
            <UserIdentity config={config} />
          )}
        </>
      )}
    </Box>
  );

  const useColumnLayout = loggedOut || isNarrow;

  return (
    <Box flexDirection="column">
      {showHeader && (
        <Box
          flexDirection={useColumnLayout ? 'column' : 'row'}
          marginTop={1}
          marginBottom={1}
          paddingLeft={1}
        >
          {renderLogo()}
          {useColumnLayout ? (
            <Box marginTop={1}>{renderMetadata(true)}</Box>
          ) : (
            renderMetadata(false)
          )}
        </Box>
      )}

      {/* F6 (PLUMB-UI-DEVRIM-PROMPT.md), scoped: a one-line greeting for
          the true empty-history moment. Read once per render, not tied to
          any timer -- this is not a live clock. */}
      {showHeader && history.length === 0 && (
        <Box paddingLeft={1} marginBottom={1}>
          <Text color={theme.text.secondary} italic>
            {getTimeBasedGreeting(new Date())}
          </Text>
        </Box>
      )}

      {bannerVisible && bannerText && (
        <Banner
          width={terminalWidth}
          bannerText={bannerText}
          isWarning={bannerData.warningText !== ''}
        />
      )}

      {!(settings.merged.ui.hideTips || config.getScreenReader()) &&
        showTips && <Tips config={config} />}
    </Box>
  );
};

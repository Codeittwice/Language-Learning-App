import { useColorScheme } from 'react-native';

import { type Theme, themeFor } from '@/theme/tokens';

/** The themed token set for the current colour scheme. */
export function useTheme(): Theme {
  const scheme = useColorScheme();
  return themeFor(scheme === 'dark' ? 'dark' : 'light');
}

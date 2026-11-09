/**
 * The five tabs.
 *
 * The practice session is deliberately NOT a tab -- it is a full-screen stack that
 * hides this bar. Tabs are for browsing; the session is for focus, with exactly one
 * thing to do on screen.
 */
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { type ColorValue, StyleSheet } from 'react-native';

import { useTheme } from '@/theme/use-theme';

type IconName = keyof typeof Ionicons.glyphMap;

type TabIconProps = {
  idle: IconName;
  active: IconName;
  color: ColorValue;
  size: number;
  focused: boolean;
};

/** Outline when idle, filled when selected -- the usual tab-bar convention. */
function TabIcon({ idle, active, color, size, focused }: TabIconProps) {
  return (
    <Ionicons
      name={focused ? active : idle}
      size={size}
      // The navigator types colour as ColorValue, which allows null; Ionicons wants
      // a string, and `undefined` makes it fall back to the inherited colour.
      color={typeof color === 'string' ? color : undefined}
    />
  );
}

export default function TabsLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textFaint,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: theme.colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: (props) => <TabIcon idle="today-outline" active="today" {...props} />,
        }}
      />
      <Tabs.Screen
        name="dictionary"
        options={{
          title: 'Dictionary',
          tabBarIcon: (props) => <TabIcon idle="search-outline" active="search" {...props} />,
        }}
      />
      <Tabs.Screen
        name="book"
        options={{
          title: 'Book',
          tabBarIcon: (props) => <TabIcon idle="book-outline" active="book" {...props} />,
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: 'Progress',
          tabBarIcon: (props) => (
            <TabIcon idle="stats-chart-outline" active="stats-chart" {...props} />
          ),
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: 'You',
          tabBarIcon: (props) => <TabIcon idle="person-outline" active="person" {...props} />,
        }}
      />
    </Tabs>
  );
}

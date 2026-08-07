import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { font, useColors } from '../../src/theme';

/**
 * Icon (24) + label (14) + padding, before the home-indicator inset is added.
 * Deliberately roomier than the sum: iOS renders the label taller than the
 * headless browser does, and the overflow is what crops the descenders.
 */
const WEB_TAB_BAR_HEIGHT = 70;

export default function TabsLayout() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.owed,
        tabBarInactiveTintColor: c.textFaint,
        // flexShrink: 0 is the important one. The label is a flex child next to
        // the icon, and the browser default lets it shrink - so it was handed
        // whatever height the icon left over (9px against a 14px line box) and
        // its own overflow:hidden cropped the text in half. Refusing to shrink
        // makes the label keep its line box and the bar absorb the difference.
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          lineHeight: 14,
          flexShrink: 0,
        },
        tabBarStyle: {
          backgroundColor: c.header,
          borderTopColor: c.border,
          // Native gets a correct intrinsic height from react-navigation; the
          // web tab bar does not, so on iOS Safari the labels were clipped.
          // Sizing it here - content height plus the home indicator - is the
          // only version that holds in a standalone PWA.
          ...(Platform.OS === 'web'
            ? {
                height: WEB_TAB_BAR_HEIGHT + insets.bottom,
                paddingTop: 8,
                // The +8 keeps the labels off the very bottom edge on a phone
                // with no home indicator to inset against.
                paddingBottom: insets.bottom + 8,
              }
            : null),
        },
        headerStyle: { backgroundColor: c.header },
        headerTitleStyle: { ...font.h2, color: c.text },
        headerTintColor: c.text,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Groups',
          tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ color, size }) => <Ionicons name="pulse-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet } from 'react-native';
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
          // c.card, not c.header. In dark mode header and bg are the same
          // colour, so the bar's own bottom padding was indistinguishable from
          // the page behind it and the labels read as floating in space with a
          // gap underneath — which is what "not stuck to the bottom" looked
          // like even when the bar was exactly where it belonged.
          backgroundColor: c.card,
          borderTopColor: c.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          // Native gets a correct intrinsic height from react-navigation; the
          // web tab bar does not, so on iOS Safari the labels were clipped.
          // Sizing it here - content height plus the home indicator - is the
          // only version that holds in a standalone PWA.
          // Left in normal flow on purpose. position:fixed was tried and is
          // actively wrong here: a fixed element is trapped by any ancestor
          // with a transform, and react-navigation's screen animator provides
          // one — so "bottom: 0" resolved to the bottom of the navigator, not
          // the screen, and parked the bar above the home indicator. With
          // #root correctly filling the viewport, flow puts it at the bottom.
          ...(Platform.OS === 'web'
            ? {
                height: WEB_TAB_BAR_HEIGHT + insets.bottom,
                paddingTop: 8,
                // The +8 keeps the labels off the very bottom edge on a phone
                // with no home indicator to inset against.
                paddingBottom: insets.bottom + 8,
                // Pull the bar back down onto the screen edge.
                //
                // Every layer between #root and this bar is flex:1 — checked in
                // expo-router's own BottomTabView and SafeAreaProviderCompat —
                // and styles.bottom carries no absolute positioning, so nothing
                // in the navigator is holding the bar up. The container itself
                // stops one home-indicator short of the screen, which is why
                // the leftover band measured exactly insets.bottom every time,
                // on tab routes and stack routes alike.
                //
                // A negative bottom margin on the last flex child shrinks the
                // space it claims, so the scene above it grows by the same
                // amount and the bar lands on the true bottom edge. Its own
                // paddingBottom still holds the labels clear of the indicator.
                // Where there is no inset — Android, desktop — this is 0 and
                // changes nothing.
                marginBottom: -insets.bottom,
              }
            : null),
        },
        headerStyle: { backgroundColor: c.header },
        headerTitleStyle: { ...font.h2, color: c.text },
        headerTintColor: c.text,
        headerShadowVisible: false,
        // No padding reservation: an in-flow bar already takes its own space
        // out of the scene, and adding it here double-counted the gap.
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
        name="personal"
        options={{
          title: 'Personal',
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" size={size} color={color} />,
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

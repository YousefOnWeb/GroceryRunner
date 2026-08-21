import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useColorScheme } from '@/components/useColorScheme';
import { SettingsProvider } from '@/utils/settings';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import migrations from '../drizzle/migrations';
import { db } from '../db';
import { api } from '@/db/api';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    'Cinzel-Bold': require('../assets/fonts/Cinzel/static/Cinzel-Bold.ttf'),
    'Cinzel-Regular': require('../assets/fonts/Cinzel/static/Cinzel-Regular.ttf'),
    'Estedad-Thin': require('../assets/fonts/Estedad/static/Estedad-Thin.ttf'),
    'Estedad-ExtraLight': require('../assets/fonts/Estedad/static/Estedad-ExtraLight.ttf'),
    'Estedad-Light': require('../assets/fonts/Estedad/static/Estedad-Light.ttf'),
    'Estedad-Regular': require('../assets/fonts/Estedad/static/Estedad-Regular.ttf'),
    'Estedad-Medium': require('../assets/fonts/Estedad/static/Estedad-Medium.ttf'),
    'Estedad-SemiBold': require('../assets/fonts/Estedad/static/Estedad-SemiBold.ttf'),
    'Estedad-Bold': require('../assets/fonts/Estedad/static/Estedad-Bold.ttf'),
    'Estedad-ExtraBold': require('../assets/fonts/Estedad/static/Estedad-ExtraBold.ttf'),
    'Estedad-Black': require('../assets/fonts/Estedad/static/Estedad-Black.ttf'),
    ...FontAwesome.font,
  });

  const { success: migrationSuccess, error: migrationError } = useMigrations(db, migrations);

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
    if (migrationError) throw migrationError;
  }, [error, migrationError]);

  useEffect(() => {
    if (loaded && migrationSuccess) {
      SplashScreen.hideAsync();
    }
  }, [loaded, migrationSuccess]);

  if (!loaded || !migrationSuccess) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SettingsProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
          </Stack>
        </ThemeProvider>
      </SettingsProvider>
    </GestureHandlerRootView>
  );
}

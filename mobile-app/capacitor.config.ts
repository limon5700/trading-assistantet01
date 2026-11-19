import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aitrading.assistant',
  appName: 'AI Trading Assistant',
  webDir: 'dist',
  android: {
    backgroundColor: '#f8fafc',
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
